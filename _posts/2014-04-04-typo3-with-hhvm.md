---
layout: post
title: "TYPO3 6.2 with HHVM"
description: "Guide for a production setup with HHVM and a PHP-FPM fallback"
category: "TYPO3"
tags: [typo3,hhvm,nginx]
---
{% include JB/setup %}

This post descripes a proof of concept for serving TYPO3 with NGINX/HHVM and a PHP-FPM fallback for incompatible scripts.
Since I am using debian this post targets *debian wheezy*.

## Installing the required packages

We will need:

* nginx
* hhvm
* PHP with these modules: curl, gd, mysql
* PHP-FPM
* Graphicsmagick
* MySQL/MariaDB

```bash
wget -O - http://dl.hhvm.com/conf/hhvm.gpg.key | sudo apt-key add -
echo deb http://dl.hhvm.com/debian wheezy main | sudo tee /etc/apt/sources.list.d/hhvm.list
sudo apt-get update
sudo apt-get install nginx hhvm graphicsmagick mysql-server php5 php5-curl php5-fpm php5-gd php5-mysqlnd
```

## Configuring NGINX

Create a new site configuration e.g. */etc/nginx/sites-available/demo* with the following content:

<script src="https://gist.github.com/phbergsmann/9975380.js"></script>

## Testing the configuration

First test if the default PHP-runtime is HHVM by providing the following *index.php*:

{% highlight php %}
<?php

phpinfo();
{% endhighlight %}

Should return "HipHop"

Now let's try the PHP-FPM fallback by providing the following *fallback.php*:

{% highlight php %}
<?php

if (defined('HHVM_VERSION')) {
        echo 'HHVM';
        throw new Exception();
}
phpinfo();
{% endhighlight %}

This should return the usual PHPInfo