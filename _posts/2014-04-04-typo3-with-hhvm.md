---
layout: post
title: "TYPO3 6.2 with HHVM"
description: "Guide for a production setup with HHVM and a PHP-FPM fallback"
category: "TYPO3"
tags: [typo3,hhvm,nginx]
---
{% include JB/setup %}

This post descripes a proof of concept for serving TYPO3 with NGINX/HHVM and a PHP-FPM fallback for incompatible scripts.
Since I am using debian this post targets *debian wheezy*. in [this post](/typo3/2014/04/04/typo3-hhvm-speed-comparison/) you'll find
some **performance comparisons**.

## Installing the required packages

We will need:

* Nginx
* HHVM
* PHP
* PHP-FPM

TYPO3 specific packages:

* MySQL/MariaDB
* Graphicsmagick
* PHP modules: curl, gd, mysqlnd

{% highlight bash %}
wget -O - http://dl.hhvm.com/conf/hhvm.gpg.key | sudo apt-key add -
echo deb http://dl.hhvm.com/debian wheezy main | sudo tee /etc/apt/sources.list.d/hhvm.list
sudo apt-get update
sudo apt-get install nginx hhvm graphicsmagick mysql-server php5 php5-curl php5-fpm php5-gd php5-mysqlnd
{% endhighlight %}

Now make sure that php-fpm, hhvm and nginx service are all running!

## Configuring NGINX

Create a new site configuration e.g. */etc/nginx/sites-available/demo* with the following content, symlink it to
*/etc/nginx/sites-enabled/demo* and reload nginx:

<script src="https://gist.github.com/phbergsmann/9975380.js"></script>

**Special configuration explanation**

Line 69 enables error interception for fast-cgi. With this setting it's possible to redirect the request to the PHP-FPM
 on error 500 (see line 70). You can extend line 70 with every error-code you want to redirect to PHP-FPM.

Example:

{% highlight nginx %}
error_page      500 501 502 503 = @fpm;
{% endhighlight %}

## Testing the configuration

First test if the default PHP-runtime is HHVM by providing the following *index.php*:

{% highlight php %}
<?php

phpinfo();
{% endhighlight %}

This should return "HipHop".

Now let's try the PHP-FPM fallback by providing the following *fallback.php*:

{% highlight php %}
<?php

if (defined('HHVM_VERSION')) {
        throw new Exception();
}

phpinfo();
{% endhighlight %}

This should return the usual PHP-info.

If I forgot something or something is wrong let me know through the comments!