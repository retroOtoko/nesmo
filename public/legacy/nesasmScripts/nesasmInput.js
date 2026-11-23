if (typeof define !== 'function') {
    var define = require('amdefine')(module);
}

define(["../nesasmScripts/nesasm", "../chrScripts/utils"], function(nesasm, utils) {
  var fileType;
  var textFiles = [];
  var binaryFiles = [];
  var readFiles = 0;
  var mainAsmFile;
  var includesNecessary = 0;

  var NesAssembler = function() {
    this.assemblerDelegate = null;
  };

  NesAssembler.prototype = new NesAssembler();
  NesAssembler.prototype.constructor = NesAssembler;
  NesAssembler.prototype.assemble = function(files) {
    // files is a FileList of File objects. List some properties.
    var output = [];
    var fileName;
    readFiles = files.length;
    for (var i = 0, f; f = files[i]; i++) {
        fileName = f.name;
        fileType = fileName.substr(fileName.length - 3);
        output.push('<li><strong>', escape(f.name), '</strong> (', fileType, ') - ',
            f.size, ' bytes, last modified: ',
            f.lastModifiedDate ? f.lastModifiedDate.toLocaleDateString() : 'n/a',
            '</li>');

        var reader = new FileReader();
        reader.onload = (function(theFile) {
            return function(e) {
                readFiles = readFiles - 1;

                if (theFile.name.includes('chr')) {
                    binaryFiles[theFile.name] = e.target.result;
                } else {
                    textFiles[theFile.name] = e.target.result;
                    if (e.target.result.includes('.ines')) {
                        mainAsmFile = theFile.name;
                        includesNecessary = 0;
                        var includePoint = e.target.result.indexOf('.include');
                        while(includePoint >= 0){
                          includesNecessary++;
                          includePoint = e.target.result.indexOf('.include', includePoint + 1);
                        }
                        includePoint = e.target.result.indexOf('.incbin');
                        while(includePoint >= 0){
                          includesNecessary++;
                          includePoint = e.target.result.indexOf('.incbin', includePoint + 1);
                        }
                    }
                }

                if (readFiles == 0) {
                    if (!mainAsmFile) {
                        alert('No main ASM file found.');
                    } else {
                        //Do includes
                        while (textFiles[mainAsmFile].indexOf('.include') >= 0) {
                            var incBeginning = textFiles[mainAsmFile].indexOf('.include');

                            if (incBeginning < 0) {
                                break;
                                alert('No includes left.');

                            }
                            var firstQuote = textFiles[mainAsmFile].indexOf('"', incBeginning + 1);

                            var secondQuote = textFiles[mainAsmFile].indexOf('"', firstQuote + 1);
                            var incLine = textFiles[mainAsmFile].substr(incBeginning, secondQuote - incBeginning + 1);

                            var fnStart = incLine.lastIndexOf('/');

                            if (fnStart < 0) fnStart = incLine.indexOf('"');

                            var incFile = incLine.substr(fnStart + 1, (incLine.length - fnStart) - 2);

                            var includeText = textFiles[incFile];

                            if (!includeText) {
                                alert('ASM File not found, please select ' + incFile);
                                break;
                            } else {
                                textFiles[mainAsmFile] = textFiles[mainAsmFile].replace(incLine, '\n  ' + includeText);
                                includesNecessary--;
                            }
                        }

                        //Do incbins
                        while (textFiles[mainAsmFile].indexOf('.incbin') >= 0) {
                            var incBeginning = textFiles[mainAsmFile].indexOf('.incbin');

                            if (incBeginning < 0) {
                                break;
                            }
                            var firstQuote = textFiles[mainAsmFile].indexOf('"', incBeginning + 1);

                            var secondQuote = textFiles[mainAsmFile].indexOf('"', firstQuote + 1);
                            var incLine = textFiles[mainAsmFile].substr(incBeginning, secondQuote - incBeginning + 1);

                            var fnStart = incLine.lastIndexOf('/');

                            if (fnStart < 0) fnStart = incLine.indexOf('"');

                            var incFile = incLine.substr(fnStart + 1, (incLine.length - fnStart) - 2);

                            var includeBin = binaryFiles[incFile];

                            if (!includeBin) {
                                alert('Binary file not found, please select ' + incFile);
                                break;
                            } else {
                                textFiles[mainAsmFile] = textFiles[mainAsmFile].replace(incLine, '\n   .db ' + new Uint8Array(includeBin));
                                includesNecessary--;
                            }
                        }
                    }
                }

                if (mainAsmFile && includesNecessary <= 0) {
                    const nesasmPromise = nesasm(textFiles[mainAsmFile]).then(function(result) {
                      console.log("Assembled to NES successfully.");
                      //Successfully assembled the file - let's download it!
                      utils.downloadBlob(result.output, mainAsmFile.substr(0, mainAsmFile.lastIndexOf('.')) + '.nes', 'application/octet-stream');
                      if(instance.assemblerDelegate) instance.assemblerDelegate.gotNESFile(result.output, mainAsmFile);

                      if(result.fns){
                        console.log("And got FNS file.");
                        if(instance.assemblerDelegate) instance.assemblerDelegate.gotFNSFile(result.fns, mainAsmFile);
                        utils.downloadBlob(result.fns, mainAsmFile.substr(0, mainAsmFile.lastIndexOf('.')) + '.fns', 'text/plain');
                      }
                      if(result.lst){
                        console.log("And got LST file.");
                        if(instance.assemblerDelegate) instance.assemblerDelegate.gotLSTFile(result.lst, mainAsmFile);
                        utils.downloadBlob(result.lst, mainAsmFile.substr(0, mainAsmFile.lastIndexOf('.')) + '.lst', 'text/plain');
                      }

                    }, function(errorResult) {
                        console.log("Failed to assemble to NES - ");
                        console.error(errorResult);
                        alert(errorResult);
                    });
                }
            };
        })(f);

        if (fileType.includes('chr'))
            reader.readAsArrayBuffer(f);
        else
            reader.readAsText(f);
    }
  };

  var instance = new NesAssembler();

  return instance;
});
