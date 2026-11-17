# Balai for Windows

A small desktop app that keeps a Windows computer clean and healthy.

Balai shows what is wrong, lets you act on it and frees disk space. Everything
happens on your computer: no account, no cloud service, no tracking.

## Download

**[Download Balai-Setup.exe](https://github.com/toscani-tenekeu/balai-windows/releases/latest/download/Balai-Setup.exe)**

Requirements: Windows 10 or Windows 11, 64-bit.

Run the installer and follow its steps. Balai asks for administrator rights each
time it opens, because cleaning Windows folders, managing services and
uninstalling programs need them.

The installer is not signed with a paid certificate yet, so Windows SmartScreen
may say “Windows protected your PC”. Choose **More info**, then **Run anyway**.

## What it does

- **Overview**: processor, memory and every drive at a glance, with a usage chart, and health checks for free space, memory, a pending restart, Microsoft Defender, the firewall, disk health, unexpected shutdowns, program crashes and the page file.
- **Processes**: see what uses the processor and memory, and close or end a program.
- **Startup apps**: choose which programs start when you sign in. Turning one off works like Task Manager and can be undone.
- **Services**: start, stop or restart Windows services and change their startup type.
- **Cleanup**: temporary files, crash dumps, error reports, old Windows logs, the Delivery Optimization cache, the Recycle Bin, Windows Update downloads, browser caches, developer tool caches, superseded Windows components and the DNS cache. Each item shows how much it would free before you run it.
- **Disk**: every drive, and a folder browser that shows where the space goes and lets you delete what you no longer need.
- **Files**: find files by extension, size or age, such as every `.zip` or everything over 1 GB, and delete the ones you pick.
- **Programs**: uninstall programs, and update them with winget, one at a time or all at once.
- **Ports**: which programs are waiting for connections, and whether other devices can reach them. Stop the program or service behind a port.
- **Activity**: a record of everything done from Balai.
- **Updates**: Balai checks for new versions and installs them from Settings, on request or automatically.

Every action that changes something asks for confirmation first and says what
it will do. Deleted files go to the Recycle Bin unless you choose otherwise, and
files and folders Windows needs cannot be deleted from Balai.

## Updating

Open **Settings** and choose **Check for updates**. When a new version is
available, download it and choose **Install and restart**. With
**Download updates automatically** turned on, Balai fetches new versions on its
own and installs them when you close it.

## Uninstall

Open **Settings › Apps › Installed apps** in Windows, find Balai and choose
**Uninstall**. Its data stays in `%APPDATA%\Balai` until you delete that folder.

## How it is built

- **App**: [Electron](https://www.electronjs.org), with Node's built-in SQLite for the usage history, settings and activity record.
- **Interface**: Vue 3 with [shadcn-vue](https://www.shadcn-vue.com) components and Tailwind CSS.
- **System data**: Windows' own tools (PowerShell, taskkill, DISM and winget). Values from the interface are always passed as data, never as part of a command.

Every build runs a self-test on a real Windows machine before an installer is
published.

### Development

Building needs Node.js 24.

```bash
npm install
npm run build        # interface and main process
npm run dist         # Windows installer in release/ (run on Windows)
```

Pushing a tag such as `v0.1.0` builds, tests and publishes a release.

## License

MIT
