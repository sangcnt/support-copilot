ARG PHP_VERSION=8.5
FROM php:${PHP_VERSION}-fpm-alpine

RUN apk add --no-cache libpq-dev linux-headers \
    && apk add --no-cache --virtual .build-dependencies $PHPIZE_DEPS \
    && docker-php-ext-install pcntl pdo_pgsql \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apk del .build-dependencies

COPY --from=composer:2.9 /usr/bin/composer /usr/local/bin/composer
COPY infrastructure/php/uploads.ini /usr/local/etc/php/conf.d/uploads.ini

WORKDIR /var/www/html

COPY backend/composer.json backend/composer.lock ./
RUN composer install \
    --no-interaction \
    --no-progress \
    --prefer-dist \
    --no-scripts

COPY backend/ ./

RUN touch .env \
    && composer dump-autoload --optimize \
    && chown -R www-data:www-data bootstrap/cache storage

EXPOSE 9000

CMD ["php-fpm"]
