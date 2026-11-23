// Side drawer: switch projects, start from a sample, import/export, and
// manage the files in the current project.
import { app } from '../app';
import {
  listProjects, loadProject, saveProject, deleteProject, projectFromSample, exportZip, importZip,
  download, isText, flushSave,
} from '../project/store';
import { samples } from '../project/samples';
import { h, clear, toast } from './dom';

export class FilesDrawer {
  el: HTMLElement;
  private body = h('div', { class: 'drawer-body' });
  private fileInput = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
  private zipInput = h('input', { type: 'file', accept: '.zip,application/zip', style: { display: 'none' } });
  onOpenFile: (name: string) => void = () => {};

  constructor() {
    this.el = h('div', { class: 'drawer' },
      h('div', { class: 'drawer-scrim', onclick: () => this.close() }),
      h('aside', { class: 'drawer-panel' }, this.body, this.fileInput, this.zipInput),
    );
    this.fileInput.addEventListener('change', () => this.uploadFiles());
    this.zipInput.addEventListener('change', () => this.importZip());
    app.on('project', () => this.isOpen() && this.render());
  }

  isOpen() {
    return this.el.classList.contains('open');
  }

  open() {
    this.render();
    this.el.classList.add('open');
  }

  close() {
    this.el.classList.remove('open');
  }

  private async render() {
    const p = app.project;
    clear(this.body);
    const files = Object.keys(p.files).sort((a, b) => (isText(b) ? 1 : 0) - (isText(a) ? 1 : 0) || a.localeCompare(b));
    this.body.append(
      h('div', { class: 'drawer-head' },
        h('h2', null, p.name),
        h('button', { class: 'btn small', onclick: () => this.rename() }, 'Rename'),
      ),
      h('h3', null, 'Files'),
      h('div', { class: 'file-list' },
        ...files.map((f) => h('div', { class: 'file' + (f === p.openFile ? ' on' : '') },
          h('button', { class: 'file-name', onclick: () => { this.onOpenFile(f); this.close(); } },
            h('span', { class: 'file-icon' }, /\.chr$/i.test(f) ? '▦' : isText(f) ? '≡' : '◆'), f),
          h('button', { class: 'icon', title: 'Rename', onclick: () => this.renameFile(f) }, '✎'),
          h('button', { class: 'icon', title: 'Download', onclick: () => download(f.split('/').pop()!, p.files[f]) }, '⤓'),
          h('button', { class: 'icon', title: 'Delete', onclick: () => this.deleteFile(f) }, '✕'),
        )),
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => this.newFile() }, '+ New file'),
        h('button', { class: 'btn', onclick: () => this.fileInput.click() }, 'Upload…'),
      ),
      h('h3', null, 'This project'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: () => this.downloadRom() }, 'Download .nes'),
        h('button', { class: 'btn', onclick: async () => download(slug(p.name) + '.zip', await exportZip(p)) }, 'Export .zip'),
        h('button', { class: 'btn danger', onclick: () => this.deleteProject() }, 'Delete'),
      ),
      h('h3', null, 'Projects'),
    );
    const list = h('div', { class: 'project-list' });
    this.body.append(list);
    const all = (await listProjects()).sort((a, b) => b.updated - a.updated);
    for (const s of all) {
      list.append(h('button', { class: 'project' + (s.id === p.id ? ' on' : ''), onclick: () => this.switchTo(s.id) },
        h('span', null, s.name), h('span', { class: 'muted small' }, new Date(s.updated).toLocaleDateString())));
    }
    this.body.append(
      h('h3', null, 'New project'),
      ...samples().map((s) => h('button', { class: 'sample', onclick: () => this.fromSample(s.name) },
        h('b', null, s.name), h('span', { class: 'muted small' }, s.description))),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => this.zipInput.click() }, 'Import .zip…')),
      h('p', { class: 'muted small' }, 'Projects are saved on this device. Export a .zip to move one between your phone and Mac.'),
    );
  }

  private async switchTo(id: string) {
    await flushSave();
    const p = await loadProject(id);
    if (!p) return;
    await saveProject(p);
    app.setProject(p);
    this.close();
  }

  private async fromSample(name: string) {
    const s = samples().find((x) => x.name === name)!;
    const title = prompt('Project name', s.name);
    if (!title) return;
    await flushSave();
    const p = projectFromSample(s, title);
    await saveProject(p);
    app.setProject(p);
    this.close();
  }

  private rename() {
    const n = prompt('Project name', app.project.name);
    if (!n) return;
    app.project.name = n;
    saveProject(app.project).then(() => { this.render(); app.emit('project', undefined); });
  }

  private newFile() {
    const n = prompt('File name (e.g. sprites.asm, constants.inc, tiles.chr)');
    if (!n) return;
    if (n in app.project.files) return toast('That file already exists');
    app.setFile(n, /\.chr$/i.test(n) ? new Uint8Array(8192) : isText(n) ? '' : new Uint8Array(0));
    this.onOpenFile(n);
    this.close();
  }

  private renameFile(f: string) {
    const n = prompt('Rename file', f);
    if (!n || n === f) return;
    if (n in app.project.files) return toast('That name is taken');
    app.renameFile(f, n);
  }

  private deleteFile(f: string) {
    if (!confirm(`Delete ${f}?`)) return;
    app.deleteFile(f);
  }

  private async deleteProject() {
    if (!confirm(`Delete the project "${app.project.name}" from this device?`)) return;
    await deleteProject(app.project.id);
    const rest = (await listProjects()).sort((a, b) => b.updated - a.updated);
    let next = rest[0] ? await loadProject(rest[0].id) : undefined;
    if (!next) {
      next = projectFromSample(samples()[0]);
      await saveProject(next);
    }
    app.setProject(next);
    this.render();
  }

  private async uploadFiles() {
    for (const f of Array.from(this.fileInput.files ?? [])) {
      const data = isText(f.name) ? await f.text() : new Uint8Array(await f.arrayBuffer());
      app.setFile(f.name, data);
    }
    toast(`Added ${this.fileInput.files?.length ?? 0} file(s)`);
    this.fileInput.value = '';
  }

  private async importZip() {
    const f = this.zipInput.files?.[0];
    this.zipInput.value = '';
    if (!f) return;
    await flushSave();
    const p = await importZip(await f.arrayBuffer(), f.name.replace(/\.zip$/i, ''));
    await saveProject(p);
    app.setProject(p);
    this.close();
    toast(`Imported ${Object.keys(p.files).length} files`);
  }

  private async downloadRom() {
    let rom = app.lastBuild?.ok ? app.lastBuild.rom : undefined;
    if (!rom || app.dirty) {
      const r = await app.build(false);
      if (!r.ok) return toast('Fix the build errors first');
      rom = r.rom;
    }
    download(slug(app.project.name) + '.nes', rom!);
  }
}

const slug = (s: string) => s.trim().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'game';
