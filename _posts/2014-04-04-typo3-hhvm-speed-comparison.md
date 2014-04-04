---
layout: post
title: "TYPO3 HHVM speed comparison"
description: ""
category: "typo3"
tags: [typo3,hhvm]
customjs:
  - https://github.com/nnnick/Chart.js/raw/master/Chart.min.js
  - /assets/posts/2014-04-04-typo3-hhvm-speed-comparison/js/charts.js
---
{% include JB/setup %}

## Test setup

* MacBook Pro i7 2.7 GHz, SSD
* Virtualbox on OSX Mavericks
* TYPO3 mounted via NFS
* Debian Wheezy
* Nginx

[Here you'll find setup instructions](/typo3/2014/04/04/typo3-with-hhvm/)

## Chart Explanation

- Grey bar: PHP-FPM
- Blue bar: HHVM
- C1 = 1 concurrent user, C10 = 10 concurrent users, C100 = 100 concurrent users
- 6.1 = TYPO3 6.1.7, 6.2 = TYPO3 6.2.0
- NC = no cache

## Chart 1: Transactions / 15 seconds

<canvas id="chart1" height="450" width="600"></canvas>

As you can see, HHVM performs up to **9x better** than PHP-FPM. There seems to be a major performance drop between TYPO3
6.2 and 6.1. I'll have to look further into that...

## Chart 2: Average response time in seconds

<canvas id="chart2" height="450" width="600"></canvas>

There is a major difference regarding the response time: With HHVM (10 concurrent connections, TYPO3 6.1) you have an
average response time of 90ms, while with PHP-FPM the average response time is 730ms. That's about **8x faster**!