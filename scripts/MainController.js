if (typeof define !== 'function') {
    var define = require('amdefine')(module);
}

//TODO: Clean up the code and make it easy to swap different modules.
//TODO: Implement metasprite spr_editor.
//TODO: Implement code editor?
//TODO: Implement zip files for assembly input.
//TODO: Fix instant loading of assembled NES roms.

define(["../nesasmScripts/nesasmInput",
    "chrScripts/ChrController.js",
    "prgScripts/PrgController.js",
    "prgScripts/6502disassembler.js",
    "chrScripts/utils.js",
    "scripts/jszip.min.js"
], function(assembler, chrInit, prgInit, disassembler, utils, jszip) {
    //Handle file selection and get everything running
    var NesnesController = function() {
        emulator.emulatorDelegate = this;
        assembler.assemblerDelegate = this;
        this.nesFile = null;
        this.lstFile = null;
        this.fnsFile = null;
    };

    NesnesController.prototype.pcUpdate = function(pcValue) {
        if (prgInit.breakpoints.includes(pcValue) && !emulator.paused) {
            console.log("Breakpoint encountered at " + pcValue);
            prgBtn.onclick();
            prgInit.breakpointFound(pcValue);
        }
    }

    NesnesController.prototype.gotNESFile = function(nesFile, forFile) {
      this.nesFile = forFile.substr(0, forFile.indexOf("."));
      console.log("Controller got nes file: " + forFile);
      emulator.initCartridge(nesFile);
      emulator.run();
      var chrData;
      if (emulator.cartridge.chrBanks == 0) chrData = emulator.cartridge.chrRead;
      else chrData = emulator.cartridge.chrData;
      chrInit.loadGraphics(chrData);
      chrInit.forceResize(); //TODO: Fix this so we don't have to run this hack to allow chr arrow functionality correctly

      disassembler.addressOffset = parseInt("0x8000");
      var disassembledPRG = disassembler.disassembleCode(utils.buf2hex(emulator.cartridge.prgRead.buffer));
      prgInit.loadPRG(disassembledPRG);
    }

    function formatFNSFile(fnsFile){
      var lines = fnsFile.split('\n');
      var aliases = "";
      for (var line of lines){
        if(line.indexOf("=") >= 0){
          var vals = line.split("=");
          aliases = aliases + vals[1].trim() + "=" + vals[0].trim() + "\n";
        }
      }
      aliases = aliases.replace(/\$/g, "");

      return aliases;
    }

    NesnesController.prototype.gotFNSFile = function(fnsFile, forFile) {
      this.fnsFile = forFile.substr(0, forFile.indexOf("."));
      var aliases = formatFNSFile(fnsFile);
      prgInit.addAliases(aliases);
    }

    function formatLSTFile(lstFile){
      var lines = lstFile.split('\n');
      var output = "";
      for (var line of lines){
        var lineNo = parseInt(line).toString();
        var newLine = line;
        if (lineNo != "NaN"){
          var bankNo = "";
          newLine = line.substr(line.indexOf(lineNo) + lineNo.length).trim();
          if(newLine[0] == ":"){
            bankNo = ":" + lineNo;
            newLine = newLine.substr(1).trim();
          }
          if(newLine[2] == ":"){
            bankNo = ":" + newLine.substr(0, 2);
            newLine = newLine.substr(3).trim();
          }
          var byteAddr = parseInt(newLine, 16).toString(16);
          if(byteAddr != "NaN"){
            while(byteAddr.length < 4) byteAddr = "0" + byteAddr;
            newLine = newLine.substr(4).trim();
            if(newLine.indexOf(".rs ") >= 0){
              var rsVar = newLine.substr(0, newLine.indexOf(".rs "));
              var labelElement = document.getElementById(byteAddr);
              if(labelElement) labelElement.innerHTML = rsVar;
            }
            if(newLine.indexOf("=") >= 0){
              var rsVar = newLine.substr(0, newLine.indexOf("="));
              var labelElement = document.getElementById(byteAddr);
              if(labelElement) labelElement.innerHTML = rsVar;
            }
            newLine = byteAddr + bankNo + " " + newLine;
          }
        }
        output = output + newLine + "\n";
      }
      return output;
    }

    NesnesController.prototype.gotLSTFile = function(lstFile, forFile) {
      this.lstFile = forFile.substr(0, forFile.indexOf("."));
      var output = formatLSTFile(lstFile);
      prgInit.loadPRG(output);
    }

    var instance = new NesnesController();

    function handleFileSelect(evt) {
      //Audio context can only be enabled after user input
      emulator.output.audio.context.resume();

        var files = evt.target.files; // FileList object

        for(var f of files){
          if (f.name.indexOf(".nes") >= 0) {
              var reader = new FileReader();
              reader.onload = (function(theFile) {
                  return function(e) {
                      console.log("NES File length: " + e.target.result.byteLength);

                      instance.nesFile = theFile.name.substr(0, theFile.name.indexOf(".nes"));
                      emulator.initCartridge(e.target.result);
                      emulator.run();
                      var chrData;
                      if (emulator.cartridge.chrBanks == 0) chrData = emulator.cartridge.chrRead;
                      else chrData = emulator.cartridge.chrData;
                      chrInit.loadGraphics(chrData);
                      chrInit.forceResize(); //TODO: Fix this so we don't have to run this hack to allow chr arrow functionality correctly

                      if(instance.nesFile != instance.fnsFile && instance.nesFile != instance.lstFile){
                        instance.fnsFile = instance.lstFile = null;
                        for(var i = 0; i < 0x0800; i++){
                          var addr = i.toString(16);
                          while (addr.length < 4) {addr = "0"+addr;}
                          document.getElementById(addr).innerHTML = addr;
                        }

                        //Disassemble only if we have no fns or lst file to reference.
                        disassembler.addressOffset = parseInt("0x8000");
                        var disassembledPRG = disassembler.disassembleCode(utils.buf2hex(emulator.cartridge.prgRead.buffer));
                        prgInit.loadPRG(disassembledPRG);
                      }
                  };
              })(f);
              reader.readAsArrayBuffer(f);
          } else if(f.name.indexOf(".zip") >= 0) {
            var zipUtil = new JSZip();

  //          var ness = new assembler.NesAssembler();
  //          ness.assemble(files);
          } else if(f.name.indexOf(".fns") >= 0) {
            var reader = new FileReader();
            reader.onload = (function(theFile) {
                return function(e) {
                  instance.fnsFile = theFile.name.substr(0, theFile.name.indexOf(".fns"));
                    var aliases = formatFNSFile(e.target.result);
                    prgInit.addAliases(aliases);
                };
            })(f);
            reader.readAsText(f);
          } else if(f.name.indexOf(".lst") >= 0) {
            var reader = new FileReader();
            reader.onload = (function(theFile) {
                return function(e) {
                  instance.lstFile = theFile.name.substr(0, theFile.name.indexOf(".lst"));
                    var lines = formatLSTFile(e.target.result);
                    prgInit.loadPRG(lines);
                };
            })(f);
            reader.readAsText(f);
          } else {
              assembler.assemble([f]);
          }
        }
    }
    document.getElementById('files').addEventListener('change', handleFileSelect, false);

    //Setup listeners and handle onscreen controls
    var buttons = ['portrait_a', 'portrait_b', 'portrait_select', 'portrait_start', 'portrait_up', 'portrait_down', 'portrait_left', 'portrait_right'];
    var pointerLocations = [];

    buttons.forEach((item, i) => {
        document.getElementById(item).addEventListener('pointerdown', function(ev) {
            ev.preventDefault();
            if (item == "portrait_left") {
                emulator.controllers.controller0.depress("right");
                emulator.controllers.controller0.depress("up");
                emulator.controllers.controller0.depress("down");
            }
            if (item == "portrait_right") {
                emulator.controllers.controller0.depress("left");
                emulator.controllers.controller0.depress("up");
                emulator.controllers.controller0.depress("down");
            }
            if (item == "portrait_up") {
                emulator.controllers.controller0.depress("down");
                emulator.controllers.controller0.depress("left");
                emulator.controllers.controller0.depress("right");
            }
            if (item == "portrait_down") {
                emulator.controllers.controller0.depress("up");
                emulator.controllers.controller0.depress("left");
                emulator.controllers.controller0.depress("right");
            }

            emulator.controllers.controller0.press(item.substring(9));
            pointerLocations[item] = ev.screenX;

//            if(gamepadInfo) controllerMapping[item.substring(9)] = null;
        }, false);
        document.getElementById(item).addEventListener('pointerup', function(ev) {
            emulator.controllers.controller0.depress(item.substring(9));
            if (pointerLocations[item]) {
                if (item == "portrait_b" && !pointerLocations["a"]) {
                    emulator.controllers.controller0.depress("a");
                }
            }
            pointerLocations[item] = undefined;
        }, false);
        document.getElementById(item).addEventListener('pointermove', function(ev) {
            ev.preventDefault();
            if (pointerLocations[item]) {
                var deltaX = ev.screenX - pointerLocations[item];
                if (item == "portrait_b" && deltaX > 3) {
                    emulator.controllers.controller0.press("a");
                }
                if (item == "portrait_b" && deltaX < -3) {
                    emulator.controllers.controller0.depress("a");
                }
                pointerLocations[item] = ev.screenX;
            }
        }, false);
        document.getElementById(item).addEventListener('pointercancel', function(ev) {
            emulator.controllers.controller0.depress(item.substring(9));
            if (pointerLocations[item]) {
                if (item == "portrait_b" && !pointerLocations["a"]) {
                    emulator.controllers.controller0.depress("a");
                }
            }
            pointerLocations[item] = undefined;
        }, false);
    });

/*
    var inputLoopInterval = null;
    var gamepadInfo = null;
    var controllerMapping = {
      portrait_up:12,
      portrait_down:13,
      portrait_left:14,
      portrait_right:15,
      portrait_a:0,
      portrait_b:2,
      portrait_select:17,
      portrait_start:9
    }
    window.addEventListener("gamepadconnected", (event) => {
      console.log("A gamepad connected:");
      console.log(event.gamepad);
      alert("A gamepad has been connected.");
      gamepadInfo = event.gamepad.buttons;
      inputLoopInterval = window.setInterval(inputLoop, 16);
    });

    window.addEventListener("gamepaddisconnected", (event) => {
      console.log("A gamepad disconnected:");
      console.log(event.gamepad);
      if(inputLoopInterval) window.clearInterval(inputLoopInterval);
      gamepadInfo = null;
    });

    function inputLoop(){
      var gamepads = navigator.getGamepads();
      gamepadInfo = gamepads[0].buttons;
      console.log(gamepads[0].axes);
      for(var button of buttons){
        if(gamepadInfo[controllerMapping[button]].value){
          var event = new Event('pointerdown');
          event.target = button;
//          window.dispatchEvent(event);
        } else {
          var event = new Event('pointerup');
          event.target = button;
//          window.dispatchEvent(event);
        }
      }
    }
    */

    document.getElementById("PCfield").addEventListener('input', function(ev) {
        var newVal = parseInt(document.getElementById("PCfield").value, 16);
        if(newVal && emulator.cpu){
          emulator.cpu.PC(newVal);
          prgInit.jumpTo(emulator.cpu.PC());
        }
    }, false);
    document.getElementById("Afield").addEventListener('input', function(ev) {
        var newVal = parseInt(document.getElementById("Afield").value, 16);
        if(newVal && emulator.cpu) emulator.cpu.A(newVal);
    }, false);
    document.getElementById("Xfield").addEventListener('input', function(ev) {
        var newVal = parseInt(document.getElementById("Xfield").value, 16);
        if(newVal && emulator.cpu) emulator.cpu.X(newVal);
    }, false);
    document.getElementById("Yfield").addEventListener('input', function(ev) {
        var newVal = parseInt(document.getElementById("Yfield").value, 16);
        if(newVal && emulator.cpu) emulator.cpu.Y(newVal);
    }, false);
    document.getElementById("FLAGfield").addEventListener('input', function(ev) {
        var newVal = parseInt(document.getElementById("FLAGfield").value, 2);
        if(newVal && emulator.cpu) emulator.cpu.flags(newVal);
    }, false);

    // Get the modals
    var modal = document.getElementById("chrModal");
    var prgModal = document.getElementById("prgModal");
    var metaspriteModal = document.getElementById("metaspriteModal");

    // Get the button that opens the modals
    var btn = document.getElementById("openChr");
    var prgBtn = document.getElementById("openPrg");
    //TODO: Add metasprite editor
//    var metaspriteBtn = document.getElementById("openMetasprites");


    // Get the <span> element that closes the modals
    var span = document.getElementsByClassName("close")[0];
    var prgSpan = document.getElementsByClassName("close")[2];
    var metaspriteSpan = document.getElementsByClassName("close")[1];

    // When the user clicks on the button, open the modal
    btn.onclick = function() {
        modal.style.display = "block";
        if (emulator.cartridge) {
            if (emulator.cartridge.chrBanks == 0) chrData = emulator.cartridge.chrRead;
            else chrData = emulator.cartridge.chrData;
            chrInit.loadGraphics(chrData);
        }
    }

//TODO: Add metasprite editor
/*
    metaspriteBtn.onclick = function() {
        metaspriteModal.style.display = "block";
    }
    */

    prgBtn.onclick = function() {
       if(emulator.cartridge){
       emulator.pause();

       //Do we need to reload the PRG data everytime we open this modal
       // in case the data bank is switched...? If so this is it here.
       /*
       disassembler.addressOffset = parseInt("0x8000");
       var disassembledPRG = disassembler.disassembleCode(utils.buf2hex(emulator.cartridge.prgRead.buffer));
       prgInit.loadPRG(disassembledPRG);
       prgInit.addAliases();
       */

       document.getElementById("PCfield").value = emulator.cpu.PC().toString(16);
       document.getElementById("Afield").value = emulator.cpu.A().toString(16);
       document.getElementById("Xfield").value = emulator.cpu.X().toString(16);
       document.getElementById("Yfield").value = emulator.cpu.Y().toString(16);
       document.getElementById("FLAGfield").value = emulator.cpu.flags().toString(2);
       document.getElementById("STACKfield").value = emulator.cpu.stack();

       for(var i = 0; i < 0x0800; i++){
         var addr = i.toString(16);
         while (addr.length < 4) {addr = "0"+addr;}
         document.getElementById("ram" + addr).value = emulator.cpu.ram(parseInt(addr, 16)).toString(16);
       }

       prgInit.jumpTo(emulator.cpu.PC());
       }

       prgModal.style.display = "block";
       prgInit.forceRefresh();
    }

    // When the user clicks on <span> (x), close the modal
    span.onclick = function() {
        modal.style.display = "none";
    }

    metaspriteSpan.onclick = function() {
        metaspriteModal.style.display = "none";
    }

    prgSpan.onclick = function() {
        prgModal.style.display = "none";
        if (emulator.cartridge) emulator.play();
    }

    // When the user clicks anywhere outside of the modal, close it
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
        }
        if (event.target == metaspriteModal) {
            metaspriteModal.style.display = "none";
        }
        if (event.target == prgModal) {
            prgModal.style.display = "none";
            if (emulator.cartridge) emulator.play();
        }
    }

    var ramContent = "";
    for(var i = 0; i < 0x0800; i++){
      var addr = i.toString(16);
      while (addr.length < 4) {addr = "0"+addr;}
      ramContent+= '<label id="' + addr +'">' + addr + ':</label><textarea id="ram' + addr + '" rows="1" cols="2" maxlength="2" placeholder="ff"></textarea> ';
    }
    document.getElementById("ram").innerHTML = ramContent;

    for(var i = 0; i < 0x0800; i++){
      var addr = i.toString(16);
      while (addr.length < 4) {addr = "0"+addr;}
      document.getElementById("ram" + addr).addEventListener('input', function(ev) {
          var newVal = parseInt(ev.target.value, 16);
          var address = parseInt(ev.target.id.substr(3), 16);
          if(newVal && emulator.cpu) emulator.cpu.ram(address, newVal);
      }, false);
    }


    return instance;
});
