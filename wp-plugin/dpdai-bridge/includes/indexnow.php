<?php
/**
 * IndexNow anahtari.
 *
 * IndexNow, yayin/guncelleme sonrasi arama motorlarina (Bing, Yandex, Naver…)
 * URL'yi aninda bildirmeyi saglar. Dogrulama icin site kokunde `<key>.txt`
 * dosyasi anahtari dondurmelidir. Bu eklenti anahtari uretir, saklar ve o
 * dosyayi sunar; panel de yayin aninda IndexNow API'sine ping atar.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DPDAI_INDEXNOW_OPTION = 'dpdai_indexnow_key';

/** Kalici IndexNow anahtari (yoksa uretir). */
function dpdai_indexnow_key() {
	$k = (string) get_option( DPDAI_INDEXNOW_OPTION, '' );
	if ( $k === '' ) {
		$k = wp_generate_password( 32, false, false );
		update_option( DPDAI_INDEXNOW_OPTION, $k, false );
	}
	return $k;
}

/** Site kokunde /<key>.txt istegini yakalar ve anahtari dondurur. */
add_action( 'init', 'dpdai_indexnow_serve_key' );
function dpdai_indexnow_serve_key() {
	if ( empty( $_SERVER['REQUEST_URI'] ) ) {
		return;
	}
	$path = ltrim( (string) wp_parse_url( (string) $_SERVER['REQUEST_URI'], PHP_URL_PATH ), '/' );
	$key  = dpdai_indexnow_key();
	if ( $path === $key . '.txt' ) {
		header( 'Content-Type: text/plain; charset=utf-8' );
		echo esc_html( $key );
		exit;
	}
}
