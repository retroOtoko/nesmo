if (typeof define !== 'function') {
    var define = require('amdefine')(module);
}

define([
    'chrScripts/sprite.js',
    'chrScripts/ui.js',
    'chrScripts/utils.js'
], function(sprite, ui, utils) {

    var spr_editor = $('#sprite-editor')[0];
    var loader = new ui.SpriteLoader(spr_editor);

    //sprite editor
    // These are placeholder test sprite values
    var sprites = [];
    sprites.fill(0, 0, 256);

    var options = {
        sprites: sprites,
        palette: [0x22, 0x16, 0x27, 0x18],
        sprite_x: 16,
        sprite_y: 4
    };

    var pixel_editor = new ui.PixelEditor(spr_editor, 165, 0, options);
    var palette = new ui.Palette(spr_editor, pixel_editor.position_x, pixel_editor.bottom() + 2, options);
    var preview = new ui.Preview(spr_editor, 0, 0, options);
    palette.set_picker_size(preview.height - palette.position_y);

    var color_picker = new ui.ColorPicker(spr_editor, 0, preview.bottom() + 2);
    color_picker.set_picker_size(pixel_editor.right_side() / 16);

    var selector = new ui.SpriteSelector(spr_editor, 0, color_picker.bottom() + 5, options);
    selector.set_width(pixel_editor.right_side());

    pixel_editor.addColorChangeListener(palette);
    palette.addColorChangeListener(selector);
    palette.addColorChangeListener(preview);
    palette.addColorChangeListener(pixel_editor);
    color_picker.addColorChangeListener(palette);
    selector.addPreviousPageButton("chrImages/fast_backward.png", 0, selector.bottom() + 5);
    selector.addNextPageButton("chrImages/fast_forward.png", 35, selector.bottom() + 5);

    //TODO selector sprite one by one
    //TODO selector sprite 8 by 8

    selector.addSpriteChangedListener(preview);
    preview.addSpriteChangedListener(pixel_editor);
    pixel_editor.addRedrawListener(preview);
    pixel_editor.addRedrawListener(selector);

    loader.addRedrawListener(selector);
    loader.addRedrawListener(preview);
    loader.addRedrawListener(pixel_editor);
    loader.updater = saveCHR;
    loader.addUpdateCompileButton("chrImages/check.png", 35 + 35, selector.bottom() + 5);

    function saveCHR() {
        utils.downloadBlob(new Uint8Array(selector.sprites), 'chrFile.chr', 'application/octet-stream');
        emulator.cartridge.chrData = new Uint8Array(selector.sprites);
        emulator.cartridge.chrRead = new Uint8Array(selector.sprites);
    }

    function getCursorPosition(canvas, event) {
        var totalOffsetX = 0;
        var totalOffsetY = 0;
        var canvasX = 0;
        var canvasY = 0;

        var element = canvas;

        do {
            totalOffsetX += element.offsetLeft;
            totalOffsetY += element.offsetTop;
            element = element.offsetParent;
        }
        while (element !== null);

        canvasX = event.pageX - totalOffsetX;
        canvasY = event.pageY - totalOffsetY;

        canvasX = Math.round(canvasX * (canvas.width / canvas.offsetWidth));
        canvasY = Math.round(canvasY * (canvas.height / canvas.offsetHeight));

        return {
            x: canvasX,
            y: canvasY
        };
    }
/*
    function handleFileSelect(evt) {
        var files = evt.target.files; // FileList object

        f = files[0];
        var reader = new FileReader();
        reader.onload = (function(theFile) {
            return function(e) {
            };
        })(f);
        reader.readAsArrayBuffer(f);
    }
    document.getElementById('files').addEventListener('change', handleFileSelect, false);
    */

    var ChrInit = function() {
    };

    ChrInit.prototype.loadGraphics = function(dataArray){
      loader.load_array(dataArray);
    }

    var instance = new ChrInit();

    //Input
    var touchDown = undefined;
    document.getElementById('sprite-editor').addEventListener('pointerdown',
        function(e) {
            e.preventDefault();
            touchDown = true;
            var canvas = $(this)[0];
            var pos = getCursorPosition(canvas, e);
            var widgets = [pixel_editor, palette, preview, color_picker, selector, loader];
            for (var w in widgets) {
                if (widgets[w].was_clicked(pos.x, pos.y)) {
                    widgets[w].click(pos.x, pos.y);
                    break;
                }
            }
        }, false);
    document.getElementById('sprite-editor').addEventListener('pointerup', function(ev) {
        touchDown = false;
    }, false);
    document.getElementById('sprite-editor').addEventListener('pointermove',
        function(e) {
            if (!touchDown) return;
            e.preventDefault();
            var canvas = $(this)[0];
            var pos = getCursorPosition(canvas, e);
            var widgets = [pixel_editor, palette, preview, color_picker, selector, loader];
            for (var w in widgets) {
                if (widgets[w].was_clicked(pos.x, pos.y)) {
                    widgets[w].click(pos.x, pos.y);
                    break;
                }
            }
        }, false);
    document.getElementById('sprite-editor').addEventListener('pointercancel', function(ev) {
        touchDown = false;
    }, false);

    var isPortrait = true;

    function reportWindowSize() {
        if (window.innerHeight >= window.innerWidth) {
            spr_editor.width = 421;
            spr_editor.height = 565;
            color_picker.position_x = 0;
            color_picker.position_y = preview.bottom() + 2;
            color_picker.num_rows = 4;
            color_picker.num_cols = 16;
            color_picker.recalculate_size();
            selector.position_x = 0;
            selector.position_y = color_picker.bottom() + 5;
            selector.sprite_x = 16;
            selector.set_width(pixel_editor.right_side());
            loader.updateCompileButton.position_y = selector.bottom() + 5;
            selector.previousPageButton.position_y = selector.nextPageButton.position_y = loader.updateCompileButton.position_y;

            preview.render();
            selector.render();
            pixel_editor.render();
            palette.render();
            color_picker.render();
            loader.render();
            isPortrait = true;
        } else if (window.innerHeight < window.innerWidth) {
            spr_editor.width = 675;
            spr_editor.height = 355;
            selector.position_x = pixel_editor.right_side() + 2;
            selector.position_y = 0;
            selector.sprite_x = 8;
            selector.set_width(spr_editor.width - pixel_editor.right_side() - 2);
            color_picker.position_x = pixel_editor.right_side() + 2;
            color_picker.position_y = selector.bottom() + 2;
            color_picker.num_rows = 9;
            color_picker.num_cols = 9;
            color_picker.recalculate_size();
            loader.updateCompileButton.position_y = preview.bottom() + 5;
            selector.previousPageButton.position_y = selector.nextPageButton.position_y = loader.updateCompileButton.position_y;

            preview.render();
            selector.render();
            pixel_editor.render();
            palette.render();
            color_picker.render();
            loader.render();
            isPortrait = false;
        }
    }
    window.onresize = reportWindowSize;

    ChrInit.prototype.forceResize = function(){
      reportWindowSize();
    }

    return instance;
});
