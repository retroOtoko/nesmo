# NesMo
A browser based NES development environment aimed at mobile browsers.

# Description
NesMo aims to be a portable NES development environment useable in mobile browsers. Currently it provides the following functionality:
- Browser based emulator, currently uses a modded version of NesNes: https://github.com/koenkivits/nesnes
- Ability to assemble NES files using nesasm, based on nesasm-js: https://github.com/munshkr/nesasm-js
- Ability to view and edit cartridge's character data. Edited data can be saved as a binary file.
- Debugger, which provides ability to view and edit registers, values from 0000 - 07ff and view current program in memory.
 Program viewer and character data editor based on implementation in nodeNES: https://gutomaia.net/nodeNES/

# Compiling ASM files
Press the icon in the upper left corner and select an ASM file to have NesMo compile the file. If the file has any includes or incbins it will ask you to select that file. Once all include files have been fed to the assembler it will assemble the ROM, which will be downloaded by your browser. Currently NewMo does not load assembled ROMs instantaneously.

# UI
- Top left "Cartridge" icon: Bring up browser UI for loading NES files or assembling ASM files.
- "CHR" icon: Bring up sprite editor. Left and right arrows at the bottom of the modal page through sprites on the cartridge, down arrow downloads edited CHR data as a binary file.
- "PRG" icon: Brings up debugger modal. Current register values are shown and editable　(aside from the stack) at the top, followed by memory values at 0000 - 07ff, followed by the program window, which shows a disassembly of the running code, or the content of the lst or fns file if one has been loaded. The debugger will jump to and highlight the current instruction being executed, whenever opened.
- On screen controls - browser based controller support also provided, but buttons are not currently customizable.

# Modularity
Ideally this will eventually be organized in a clean way so that it would be trivial to swap out components with those customized by others - for instance so that different emulators could be swapped in, or so that the assembler could handle cc65 instead of nesasm.
