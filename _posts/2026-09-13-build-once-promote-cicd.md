---
title: "Building a Build-Once CI/CD Pipeline with GitHub Actions and GitOps"
description: "A practical look at structuring GitHub Actions workflows so container images are built once, verified by digest, and promoted unchanged through development, staging, and production."
category: "CI/CD"
tags: [github-actions,cicd,containers,gitops,security]
classes: wide
---

I recently spent quite some time restructuring a GitHub Actions based CI/CD pipeline for a containerized application.

The main requirement sounds simple:

> The image running in production should be exactly the image that passed CI.

Not an image built from the same commit. Not an image built from the same Dockerfile. The same OCI artifact with the same digest.

This led to a pipeline where application images are built in Pull Request CI exactly once. Everything afterwards is promotion.

The implementation uses GitHub Actions, GHCR, ORAS, Trivy, Syft, cosign, Argo CD and Terraform. This post goes through the actual workflow structure and some of the implementation details.

![Build once and promote the same artifact through all environments](/assets/images/build-once-cicd.svg)

## Workflow Structure

I did not want one huge GitHub Actions workflow handling CI, releases, staging and production.

The workflows are split into entrypoints and reusable building blocks:

{% highlight text %}
.github/workflows/
├── ci.yml
├── release-request.yml
├── release-staging.yml
├── release-prod.yml
│
├── _classify-images.yml
├── _promote-images.yml
└── _terraform-apply.yml
{% endhighlight %}

The first four are triggered by events. The workflows prefixed with `_` are internal building blocks and only expose `workflow_call`.

| Workflow | Trigger | Responsibility |
| --- | --- | --- |
| `ci.yml` | Pull Request, push to `main`, manual | Quality gates, candidate build, publication and dev desired state |
| `release-request.yml` | Issue label | Validate release intent and create the Release PR |
| `release-staging.yml` | Completed CI workflow run | Prepare and promote a Release Candidate |
| `release-prod.yml` | Release PR closed/merged | Promote the staged artifact to production |
| `_classify-images.yml` | `workflow_call` | Determine which images are affected |
| `_promote-images.yml` | `workflow_call` | Verify and retag existing OCI images |
| `_terraform-apply.yml` | `workflow_call` | Apply infrastructure at an exact Git revision |

This split is not only about readability. The workflows have different trust requirements. CI may execute code from a Pull Request. Image publication needs registry write access. Production needs stronger permissions and approval. I do not want all of that in the same security context.

## CI Triggers

The CI workflow starts with fairly ordinary triggers:

{% highlight yaml %}
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
{% endhighlight %}

There is also concurrency handling:

{% highlight yaml %}
concurrency:
  group: ci-${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
{% endhighlight %}

For Pull Requests I want old runs to be canceled when a new commit arrives. For `main`, I do not. An outdated PR build is useless. Canceling an integration run on `main` because another commit arrived can hide failures.

## First Determine What Actually Needs an Image

Before the image lifecycle starts, CI calls a reusable classifier:

{% highlight yaml %}
classify-images:
  name: Classify Images
  if: ${{ github.event_name == 'pull_request' }}
  uses: ./.github/workflows/_classify-images.yml
  permissions:
    contents: read
    packages: read
  with:
    base-sha: ${{ github.event.pull_request.base.sha }}
    head-sha: ${{ github.event.pull_request.head.sha }}
    pull-request: ${{ github.event.pull_request.number }}
    mode: pr
{% endhighlight %}

The classifier exposes a small `workflow_call` interface:

{% highlight yaml %}
on:
  workflow_call:
    inputs:
      base-sha:
        required: true
        type: string
      head-sha:
        required: true
        type: string
      pull-request:
        required: true
        type: string
      mode:
        required: true
        type: string
    outputs:
      matrix:
        value: ${{ jobs.classify.outputs.matrix }}
      images-required:
        value: ${{ jobs.classify.outputs.images-required }}
      build-required:
        value: ${{ jobs.classify.outputs.build-required }}
{% endhighlight %}

It maps changed paths to container images. A simplified version looks like this:

{% highlight bash %}
case "$path" in
  src/backend/Dockerfile)
    add_images api
    ;;
  src/backend/*)
    add_images api worker
    ;;
  src/web-client/*)
    add_images web
    ;;
  src/design-system/*)
    add_images web design-system
    ;;
  docs/* | *.md)
    ;;
  *)
    all_images
    ;;
esac
{% endhighlight %}

The last case is important. Unknown paths fail closed to rebuilding everything. I would rather spend another few minutes in CI than incorrectly assume that a change cannot influence an image.

The classifier returns a JSON build matrix which the image build job consumes directly.

## Build Only After the Quality Gates

The container build is downstream of linting, type checks, infrastructure validation, tests, migrations, schema drift checks and security scans:

{% highlight yaml %}
candidate-build:
  name: Build Candidate Image
  if: ${{ github.event_name == 'pull_request' && needs.classify-images.outputs.build-required == 'true' }}
  needs:
    - lint-format
    - typecheck
    - lint-infra
    - tests
    - migrations
    - schema-drift
    - security-scan
    - adapter-integration
    - classify-images
  strategy:
    fail-fast: false
    matrix:
      include: ${{ fromJson(needs.classify-images.outputs.matrix) }}
{% endhighlight %}

If a migration is broken, I do not need a candidate image. If the source contains a HIGH or CRITICAL vulnerability, I do not need a candidate image. If TypeScript does not compile, I definitely do not need a candidate image.

## Build Once Into an OCI Layout

The actual container build is the most important part of the pipeline.

I do not build and immediately push the image. Instead, BuildKit creates an OCI layout archive:

{% highlight yaml %}
- name: Build ${{ matrix.name }} image exactly once
  uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a
  with:
    context: .
    file: ${{ matrix.dockerfile }}
    push: false
    provenance: false
    sbom: false
    outputs: "type=oci,dest=candidate-${{ matrix.name }}.oci.tar,rewrite-timestamp=true"
    cache-from: type=gha,scope=${{ matrix.cache-scope }}
    cache-to: type=gha,scope=${{ matrix.cache-scope }},mode=max
    build-args: |
      SOURCE_DATE_EPOCH=${{ steps.epoch.outputs.epoch }}
{% endhighlight %}

There are a few intentional details here:

- `push: false` means the build job does not need registry write permissions.
- `type=oci` gives me the exact artifact as a file.
- `SOURCE_DATE_EPOCH` and `rewrite-timestamp=true` remove one source of non-determinism from reruns.
- There is exactly one BuildKit invocation per image.

The archive produced by this step is the artifact which gets tested, scanned and eventually published.

## Extract the Digest Immediately

After the build I unpack the OCI layout and record its digest:

{% highlight bash %}
mkdir -p "oci-layout-${SERVICE}"
tar -xf "candidate-${SERVICE}.oci.tar" -C "oci-layout-${SERVICE}"

digest=$(jq -r '.manifests[0].digest' "oci-layout-${SERVICE}/index.json")

if ! printf '%s' "$digest" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
  echo "Unexpected digest: $digest"
  exit 1
fi
{% endhighlight %}

From this point onwards, the pipeline works with the digest, not with a mutable tag.

![Tags are names while digests identify the exact artifact](/assets/images/tags-vs-digests.svg)

## Smoke Test the Exact Digest

The OCI archive is copied into a temporary local registry and pulled by digest:

{% highlight bash %}
oras copy \
  --from-oci-layout \
  --to-plain-http \
  "oci-layout-${SERVICE}@${digest}" \
  "$LOCAL_REF"

image_ref="localhost:5000/example/${SERVICE}@${digest}"
docker pull "$image_ref"
{% endhighlight %}

Smoke tests run against this reference:

{% highlight bash %}
docker run -d \
  --name "smoke-${SERVICE}" \
  -p "127.0.0.1:18000:${port}" \
  "$image_ref"

curl "http://127.0.0.1:18000${path}"
{% endhighlight %}

I am not testing `my-image:ci`. I am testing `my-image@sha256:...`, and that digest is the artifact I want to promote later.

## Scan and Attest the Same Artifact

Trivy gets exactly the same digest:

{% highlight bash %}
trivy image \
  --insecure \
  --severity HIGH,CRITICAL \
  --ignorefile .trivyignore \
  --format sarif \
  --output "trivy-${SERVICE}-image-results.sarif" \
  --exit-code 0 \
  "localhost:5000/example/${SERVICE}@${digest}"
{% endhighlight %}

The SBOM is generated from the same image:

{% highlight yaml %}
- name: Generate SBOM
  uses: anchore/sbom-action@3ad7283483fc7af8ff2b4ea19663c2d5ca935e26
  with:
    image: "localhost:5000/example/${{ matrix.name }}@${{ steps.digest.outputs.digest }}"
    output-file: "${{ matrix.name }}-sbom.spdx.json"
    format: spdx-json
    upload-artifact: false
{% endhighlight %}

The CI artifact now contains the OCI image, the SBOM and the Trivy result. There is no rebuild between those steps.

## Separate Building From Publishing

The build job is intentionally not allowed to publish to the registry. A separate job gets those permissions:

{% highlight yaml %}
candidate-publish:
  name: Candidate Publish
  permissions:
    actions: read
    contents: read
    packages: write
    id-token: write
    statuses: write
{% endhighlight %}

That job downloads only the expected artifacts from the current workflow run, validates their contents and publishes them.

This creates a useful trust boundary: the job that runs `docker build` against potentially untrusted PR content does not automatically receive registry write access.

## Keyless Signing With GitHub OIDC

After publication, the digest is signed using cosign and GitHub's OIDC identity. There is no private signing key stored in GitHub Secrets.

The workflow first checks whether the expected signature already exists:

{% highlight bash %}
if cosign verify \
  --certificate-identity-regexp "$IDENTITY_REGEX" \
  --certificate-oidc-issuer "$OIDC_ISSUER" \
  "${image}@${digest}" >/dev/null 2>&1; then
  echo "Signature already exists"
else
  cosign sign --yes "${image}@${digest}"
fi
{% endhighlight %}

The same image also gets SLSA provenance and an SPDX SBOM attestation.

The useful question during promotion is therefore not only "is this image signed?", but "was this exact digest signed by the CI workflow I trust?".

## Updating Dev Creates a CI Loop

After publishing the candidate, CI updates the development Kustomization in the existing feature branch:

{% highlight yaml %}
images:
  - name: ghcr.io/example/api
    newTag: pr-471-0123456789abcdef...
{% endhighlight %}

I prefer this over creating another deployment PR because the application change and its resulting dev desired state are reviewed together.

It creates one interesting problem though:

{% highlight text %}
PR
 |
 v
CI
 |
 v
build candidate
 |
 v
update PR branch
 |
 v
PR changed
 |
 v
CI starts again
{% endhighlight %}

The second run must exist because the final PR head needs valid required checks. But it must not build the candidate again.

The workflow therefore recognizes a strictly validated automation-generated commit. Only if its author, changed files, commit metadata and referenced candidate match the expected contract is the heavy verification path skipped. The follow-up run verifies the already published candidate and restores the required statuses on the new PR head.

Using GitHub's native `[skip ci]` would be wrong here because it would also skip the run which branch protection needs.

## A Release Starts With Intent, Not a Version Number

Production releases use a separate workflow. The trigger is an issue label event:

{% highlight yaml %}
on:
  issues:
    types: [labeled]
{% endhighlight %}

The relevant label represents approval of the release request.

When approval happens, the workflow snapshots `main`:

{% highlight bash %}
snapshot_sha=$(gh api \
  "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" \
  --jq .object.sha)
{% endhighlight %}

Everything else is derived from repository state. The workflow determines the currently deployed candidate, verifies its source Pull Request and CI status, validates the image evidence and creates a Release PR.

I prefer this over a release form asking for a version, Git SHA and image tag. Those values already exist. The human should only express the actual intent: release the current approved state.

## Why Staging Uses `workflow_run`

Staging has a different trigger:

{% highlight yaml %}
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
{% endhighlight %}

It does not stage a Release PR immediately when it changes. It reacts to the result of CI.

The workflow first checks that it is looking at a successful Pull Request run:

{% highlight bash %}
[ "$RUN_EVENT" = "pull_request" ] || noop "Not a Pull Request run"
[ "$RUN_CONCLUSION" = "success" ] || noop "CI was not successful"
{% endhighlight %}

The workflow then verifies that the run belongs to the trusted Release PR.

This gives me the ordering I want:

{% highlight text %}
Release PR changes
       |
       v
      CI
       |
       v
 CI successful
       |
       v
staging workflow
{% endhighlight %}

Staging cannot race ahead of CI.

## Staging Deliberately Runs Twice

Staging has two passes.

On the first successful CI run of a Release PR, the workflow updates the desired state so staging points to the RC tag and production already points to the intended stable version. This creates a new Release PR head and therefore another CI run.

The workflow distinguishes those two states:

{% highlight bash %}
pass="first"

if check_all "$staging_tags" "$rc_tag" \
  && check_all "$prod_tags" "$version"; then
  pass="final"
fi
{% endhighlight %}

The jobs are then split accordingly:

{% highlight yaml %}
commit-overlays:
  if: ${{ needs.resolve.outputs.pass == 'first' }}

promote:
  if: ${{ needs.resolve.outputs.pass == 'final' }}
  uses: ./.github/workflows/_promote-images.yml
  with:
    source-tag: ${{ needs.resolve.outputs.candidate }}
    target-tag: ${{ needs.resolve.outputs.rc-tag }}
    build-sha: ${{ needs.resolve.outputs.build-sha }}
{% endhighlight %}

So the generated desired-state change itself has passed CI before the corresponding artifact reaches staging.

## Promotion Is a Reusable Workflow

The actual promotion logic lives in `_promote-images.yml` and exposes only the information it needs:

{% highlight yaml %}
on:
  workflow_call:
    inputs:
      source-tag:
        required: true
        type: string
      target-tag:
        required: true
        type: string
      build-sha:
        required: true
        type: string
{% endhighlight %}

Staging calls it for candidate to RC promotion. Production later calls the same workflow for RC to stable promotion.

There is no build operation in this workflow.

## Immutable Promotion With ORAS

Before copying anything, the workflow resolves the source digest and verifies its signature, provenance and SBOM.

The actual promotion is small:

{% highlight bash %}
if tgt_hex=$(oras manifest fetch "${image}:${TARGET_TAG}" 2>/dev/null \
  | sha256sum | cut -d' ' -f1); then

  if [ "sha256:${tgt_hex}" = "${src_digest}" ]; then
    echo "Target already exists at the same digest"
    exit 0
  fi

  echo "Target tag already points to another digest"
  exit 1
fi

oras cp "${image}@${src_digest}" "${image}:${TARGET_TAG}"
{% endhighlight %}

An existing target tag pointing to the same digest is an idempotent success. An existing target pointing somewhere else is a hard failure.

After the copy, the target is resolved again and must match the source digest:

{% highlight bash %}
tgt_hex=$(oras manifest fetch "${image}:${TARGET_TAG}" \
  | sha256sum | cut -d' ' -f1)

[ "sha256:${tgt_hex}" = "${src_digest}" ] || exit 1
{% endhighlight %}

## Production Is Triggered by Closing the Release PR

The production workflow is driven by the Release PR lifecycle:

{% highlight yaml %}
on:
  pull_request:
    types: [closed]
  workflow_dispatch:
    inputs:
      release-pr:
        required: true
        type: number
{% endhighlight %}

A `closed` event covers both a merged and a canceled release. The workflow classifies which path happened.

If the PR was closed without merging, nothing is promoted. If it was merged, production verifies that staging succeeded on exactly that Release PR head before continuing.

The additional `workflow_dispatch` is only for idempotent recovery. If a later API operation fails after the immutable promotion already succeeded, I can rerun the same release instead of inventing another one.

Production then calls the same promotion workflow:

{% highlight yaml %}
promote:
  uses: ./.github/workflows/_promote-images.yml
  with:
    source-tag: ${{ needs.classify.outputs.rc-tag }}
    target-tag: ${{ needs.classify.outputs.version }}
    build-sha: ${{ needs.classify.outputs.build-sha }}
{% endhighlight %}

There is only one promotion implementation to secure and test.

## CI Does Not Deploy to Kubernetes

None of the lifecycle workflows need to run `kubectl apply` or `oc apply`.

CI updates Git. Argo CD updates Kubernetes.

![CI changes Git desired state while Argo CD reconciles the Kubernetes cluster](/assets/images/ci-gitops-flow.svg)

For development, the dev Kustomization ends up on the main branch. For staging, I use a persistent `staging` branch as a deployment pointer. The staging workflow moves that branch to the exact validated Release PR head.

A Pull Request is temporary. Staging is not. Using a persistent branch gives me a simple representation of "this is the exact revision currently staged".

## Terraform Is Another Reusable Deployment Primitive

Infrastructure changes are separated again:

{% highlight yaml %}
on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      revision:
        required: true
        type: string
{% endhighlight %}

The important input is `revision`. Terraform does not simply check out whatever happens to be `main` when the job starts. It applies an explicitly selected Git revision.

The apply job is bound to a GitHub Environment and receives OIDC permission:

{% highlight yaml %}
apply:
  needs: inspect
  if: ${{ needs.inspect.outputs.applicable == 'true' }}
  environment: ${{ inputs.environment }}
  permissions:
    id-token: write
{% endhighlight %}

AWS authentication uses OIDC instead of permanent AWS access keys:

{% highlight yaml %}
- name: Configure AWS credentials (OIDC)
  uses: aws-actions/configure-aws-credentials@cbe3b392738ccf3f987d68400dafcf4b0624a56c
  with:
    role-to-assume: ${{ vars.AWS_ROLE_ARN }}
    aws-region: ${{ vars.AWS_REGION }}
{% endhighlight %}

The workflow also saves and applies the exact Terraform plan:

{% highlight bash %}
terraform plan -input=false -no-color -out=tfplan
terraform apply -input=false tfplan
{% endhighlight %}

## The Complete Trigger Chain

With all of this combined, the lifecycle looks like this:

{% highlight text %}
Feature Pull Request
        |
        | pull_request
        v
      ci.yml
        |
        +--> quality gates
        +--> build affected images once
        +--> smoke test exact digest
        +--> Trivy + SBOM
        +--> publish + sign + attest
        +--> update dev desired state
        |
        v
merge to main
        |
        v
Argo CD dev

Release Request issue
        |
        | approval label
        v
release-request.yml
        |
        +--> snapshot main
        +--> verify candidate
        +--> create Release PR
        |
        v
Release PR
        |
        | pull_request
        v
      ci.yml
        |
        | workflow_run completed
        v
release-staging.yml
        |
        +--> first pass: update staging/prod desired state
        +--> CI runs again
        `--> final pass: candidate -> RC, move staging pointer

Release PR merge
        |
        | pull_request: closed
        v
release-prod.yml
        |
        +--> verify staged head
        +--> RC -> stable
        +--> finalize release
        |
        v
Argo CD production
{% endhighlight %}

The triggers are doing more than starting workflows. They encode the lifecycle.

A Pull Request event means "verify a proposed change". An issue label means "a human approved release intent". A completed CI workflow means "this Release PR revision is eligible for staging evaluation". Closing the Release PR means "cancel this release or promote the already staged revision".

I find this much easier to reason about than one `deploy.yml` with twenty conditional jobs.

## Conclusion

The most important property is still simple:

{% highlight text %}
build once
    |
    v
sha256:abc...
    |
    +--> test
    +--> scan
    +--> sign
    +--> attest
    |
    +--> dev
    +--> staging
    `--> production
{% endhighlight %}

But getting there required more than removing a few `docker build` commands.

The workflow boundaries, triggers and permissions are part of the design. CI builds the artifact. A separate trust boundary publishes it. Release workflows only verify and promote it. Git stores the desired deployment state. Argo CD reconciles Kubernetes. Terraform applies infrastructure at an explicit revision.

Production never needs to assume that a freshly rebuilt image is equivalent to the one that passed CI. It gets the same digest.
