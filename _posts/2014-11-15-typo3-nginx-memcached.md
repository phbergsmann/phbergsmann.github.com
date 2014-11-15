---
layout: post
title: "TYPO3 with nginx and memcached-module"
description: "Guide for a setup with nginx, it's memcached module and TYPO3"
category: "TYPO3"
tags: [typo3,memcached,nginx]
customjs:
  - /assets/posts/2014-11-15-typo3-nginx-memcached/js/Chart.min.js
  - /assets/posts/2014-11-15-typo3-nginx-memcached/js/charts.js
---
{% include JB/setup %}

This is a proof of concept of in-memory caching with TYPO3, nginx and memcached.<!--more-->

## Overview

I read about the nginx memcached-module and thought about how to imlement that with TYPO3. The biggest advantage would be,
that you don't need any php interpreter and no disk-access to serve cached pages. Actually nearly all things to achieve
that are in the TYPO3 core by now, the only needed to be adapted a bit and sticket together.

I'm using these parts:

* The default memcached-caching-backend - with some method-overrides fo the identifiers
* The insertPageIncache-hook

## Installing the extension

If you have memcached installed on the same machine which is running the TYPO3-site you only have to install the extension
which is available [on github](https://github.com/phbergsmann/nginx_memcached) and in the TYPO3 extension repository. If your
memcached-server is on another server or ip you will have to adapt the default configuration.

## Result

I did some benchmarks on a local vagrant-machine with these results:

- Grey bar: wit default memcache
- Blue bar: with memcache access via nginx

<canvas id="chart1" height="450" width="600"></canvas>

<canvas id="chart2" height="450" width="600"></canvas>

with in-memory cache:

10 seconds, 10 concurrent users: 592 transactions/second, shortest transaction: 0.00s
10 seconds, 100 concurrent users: 718 transactions/second, shortest transaction: 0.02s

with default page-memcached-caching:

10 seconds, 10 concurrent users: 12.29 transactions/second, shortest transaction: 0.42s
10 seconds, 100 concurrent users: 12.23 transactions/second, shortest transaction: 0.43s

*That's an improvement of roughly 5000%*