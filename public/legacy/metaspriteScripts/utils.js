if (typeof define !== 'function') {
    var define = require('amdefine')(module);
}
define([], function() {
    var util = function() {};
    util.prototype.path = '';
    util.prototype.open_file = function(file) {
        if (typeof jQuery !== 'undefined') {
            return this.open_file_with_browser(this.path + file, jQuery);
        } else {
            return this.open_file_with_node(this.path + file);
        }
    };
    util.prototype.open_file_with_node = function(file) {
        var fs = require('fs');
        return fs.readFileSync(file, 'binary');
    };
    util.prototype.open_file_with_browser = function(file, jQuery) {
        var content;
        jQuery.ajax({
            url: file,
            xhr: function() {
                var xhr = $.ajaxSettings.xhr();
                if (typeof xhr.overrideMimeType !== 'undefined') {
                    xhr.overrideMimeType('text/plain; charset=x-user-defined');
                }
                self.xhr = xhr;
                return xhr;
            },
            complete: function(xhr, status) {
                content = xhr.responseText;
            },
            async: false
        });
        return content;
    };
    util.prototype.write_file = function(filename, data) {
        if (typeof window !== 'undefined') {
            this.write_file_with_browser_fileapi(filename, data);
        } else {
            this.write_file_with_node(filename, data);
        }
    };
    util.prototype.write_file_with_node = function(filename, data) {
        var fs = require('fs');
        fs.writeFileSync(filename, data, 'binary');
    };
    util.prototype.init_fs = function() {
        if (typeof window != 'undefined') {
            window.requestFileSystem = window.MozRequestFileSystem || window.webkitRequestFileSystem || window.requestFileSystem;
            if (window.requestFileSystem !== undefined) {
                window.requestFileSystem(TEMPORARY, 1024 * 1024, onInitFs, errorFileHandler, function(e) {
                    console.log('Error', e);
                });
            }
        }
    };
    util.prototype.on_write_end = function(filename, url) {};
    util.prototype.on_error = function(e) {};
    util.prototype.write_file_with_browser_fileapi = function(filename, data) {
        if (this.fs === undefined) {
            this.filename = filename;
            this.data = data;
            this.init_fs();
        } else {
            var uint = new Uint8Array(data.length);
            for (var i = 0, strLen = data.length; i < strLen; i++) {
                uint[i] = data.charCodeAt(i);
            }
            this.fs.root.getFile(filename, {
                create: true
            }, function(fileEntry) {
                fileEntry.createWriter(function(fileWriter) {
                    fileWriter.onwriteend = function(e) {
                        instance.on_write_end(filename, fileEntry.toURL());
                    };
                    fileWriter.onerror = function(e) {
                        instance.on_error(e);
                    };
                    fileWriter.write(new Blob([uint], {
                        type: "application/octet-stream"
                    }));
                }, errorFileHandler);
            }, errorFileHandler);
        }
    };

  util.prototype.downloadBlob = function(data, fileName, mimeType) {
    var blob, url;
    blob = new Blob([data], {
      type: mimeType
    });
    url = window.URL.createObjectURL(blob);
    this.downloadURL(url, fileName);
    setTimeout(function() {
      return window.URL.revokeObjectURL(url);
    }, 1000);
  };

  util.prototype.downloadURL = function(data, fileName) {
    var a;
    a = document.createElement('a');
    a.href = data;
    a.download = fileName;
    document.body.appendChild(a);
    a.style = 'display: none';
    a.click();
    a.remove();
  };

  util.prototype.buf2hex = function(buffer) { // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
  }

    var instance = new util();

    function errorFileHandler(e) {
        instance.on_error(e);
    }

    function onInitFs(fs) {
        instance.fs = fs;
        instance.write_file(instance.filename, instance.data);
        instance.filename = undefined;
        instance.data = undefined;
    }

    return instance;
});
