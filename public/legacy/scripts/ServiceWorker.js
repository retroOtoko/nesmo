	//Service worker - new way to implement cache-manifest functionality for offline
	var CACHE = 'cache-only';

	self.addEventListener('install', function(evt) {
	    console.log('The service worker is being installed.');
	    evt.waitUntil(precache());
	});

	self.addEventListener('fetch', function(evt) {
	    console.log('The service worker is serving the asset.');
	    evt.respondWith(fromCache(evt.request));
      evt.waitUntil(update(evt.request));
	});

	function precache() {
	    return caches.open(CACHE).then(function(cache) {
	        return cache.addAll([
						'chrImages/fast_forward.png',
						'chrImages/check.png',
						'chrImages/fast_backward.png',
						'chrScripts/ui.js',
						'chrScripts/.DS_Store',
						'chrScripts/jquery.min.js',
						'chrScripts/utils.js',
						'chrScripts/sprite.js',
						'chrScripts/ChrController.js',
						'css/codemirror.css',
						'css/main.css',
						'images/chr.png',
						'images/down_arrow.png',
						'images/plus.png',
						'images/start_button.png',
					  'images/.DS_Store',
						'images/left_arrow.png',
						'images/prg.png',
						'images/right_arrow.png',
						'images/apple-touch-icon-120.png',
						'images/b_button.png',
						'images/metasprites.png',
						'images/a_button.png',
						'images/up_arrow.png',
						'images/select_button.png',
						'index.html',
						'metaspriteScripts',
						'metaspriteScripts/ui.js',
						'metaspriteScripts/.DS_Store',
						'metaspriteScripts/MetaspriteController.js',
						'metaspriteScripts/jquery.min.js',
						'metaspriteScripts/utils.js',
						'metaspriteScripts/sprite.js',
						'nesasmScripts/nesasm.js',
						'nesasmScripts/nesasmInput.js',
						'oldcache.manifest',
						'prgScripts',
						'prgScripts/.DS_Store',
						'prgScripts/codemirror.js',
						'prgScripts/6502disassembler.js',
						'prgScripts/asm.js',
						'prgScripts/PrgController.js',
						'scripts/MainController.js',
						'scripts/nesnes.js',
						'scripts/.DS_Store',
						'scripts/jszip.min.js',
						'scripts/amdefine.js',
						'scripts/require.js',
						'scripts/ServiceWorker.js',
						'webappManifest.json'
	        ]);
	    });
	}

	function fromCache(request) {
	    return caches.open(CACHE).then(function(cache) {
	        return cache.match(request).then(function(matching) {
	            return matching || Promise.reject('no-match');
	        });
	    });
	}

  function update(request) {
  return caches.open(CACHE).then(function (cache) {
    return fetch(request).then(function (response) {
      return cache.put(request, response);
    });
  });
}
