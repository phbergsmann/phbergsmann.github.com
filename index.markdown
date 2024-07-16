---
title: "Welcome to Philipp Bergsmann's Personal Blog"
layout: splash
date: 2016-03-23T11:48:41-04:00
header:
  overlay_color: "#000"
  overlay_filter: "0.5"
#  overlay_image: /assets/images/intro_header_user_group_toolkit2.webp
excerpt: "Explore my highly opinionated insights into cloud computing, AI/ML, open source projects, Kubernetes, and Dev(Sec)Ops. Discover undocumented topics, interesting concepts, and practical ideas."
---

## Latest Blog Posts

{% for post in site.posts %}
  {% include archive-single.html %}
{% endfor %}