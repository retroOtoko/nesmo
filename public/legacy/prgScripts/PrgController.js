if (typeof define !== 'function') {
    var define = require('amdefine')(module);
}

//TODO: Clean up UI.
//TODO: Fix bug where window doesn't QUITE jump to current line being executed.

define([
    'chrScripts/ui.js',
    'chrScripts/utils.js'
], function(ui, utils) {

  var codemirror = CodeMirror.fromTextArea($("#asm")[0], {
      lineNumbers: true,
      matchBrackets: true,
      useCPP: true,
      mode: "text/x-asm",
      readOnly: true,
      gutters: ["breakpoints"]
  });

  var PrgInit = function() {
    this.breakpoints = [];
    this.lineDict = [];
    this.aliases = "";
  };

  PrgInit.prototype.loadPRG = function(dataArray){
    codemirror.setValue(dataArray);

    for(var i = 0; i < codemirror.lineCount(); i++){
      var line = codemirror.getLine(i);
      if(line.length > 3){
        this.lineDict[parseInt(line.substr(0, 4), 16)] = i;
      }
    }

    for(var byteNo of this.breakpoints){
      codemirror.setGutterMarker(this.lineDict[byteNo], "breakpoints", makeMarker());
    }

    codemirror.refresh();
  }

  PrgInit.prototype.forceRefresh = function(){
    codemirror.refresh();
  }

  PrgInit.prototype.breakpointFound = function(byteNo){
    this.jumpTo(byteNo);
  }

  PrgInit.prototype.jumpTo = function(byteNo){
    if(!this.lineDict[byteNo]) return;
    codemirror.setSelection({line:this.lineDict[byteNo], ch:0}, {line:this.lineDict[byteNo], ch:4});
    codemirror.scrollIntoView({line:this.lineDict[byteNo], ch:0});
  }

  PrgInit.prototype.addAliases = function(aliases){
    if(aliases) this.aliases = aliases;
    var lines = this.aliases.split("\n");
    for(var line of lines){
      var vals = line.split("=");
      if(vals.length > 1){
        var byteNo = parseInt(vals[0], 16);
        var retrievedLine = codemirror.getLine(this.lineDict[byteNo]);
        if(retrievedLine){
          codemirror.replaceRange("\t" + vals[1], {line:this.lineDict[byteNo], ch:retrievedLine.length});
        }
      }
    }
  }

  var instance = new PrgInit();

  codemirror.on("gutterClick", function(cm, n) {
  var info = cm.lineInfo(n);
  //We need to set breakpoints per byte, not per line
  var byteNo = parseInt("0x" + info.text.substr(0,4));

  if(info.gutterMarkers){
    instance.breakpoints.splice(instance.breakpoints.indexOf(byteNo), 1);
  } else {
    instance.breakpoints.push(byteNo);
  }
  cm.setGutterMarker(n, "breakpoints", info.gutterMarkers ? null : makeMarker());
});

function makeMarker() {
  var marker = document.createElement("div");
  marker.style.color = "#115";
  marker.innerHTML = "●";
  return marker;
}

    return instance;
});
