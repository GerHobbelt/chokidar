# Chokidar

> A neat wrapper around node.js fs.watch / fs.watchFile / fsevents.

[![Known Vulnerabilities][snyk-image]][snyk-url]
[![Mac/Linux Build Status][travis-image]][travis-url]
[![Windows Build Status][appveyor-image]][appveyor-url]
[![Coverage Status][coveralls-image]][coveralls-url]
![Node Version][version-image]
[![License][license-image]][license-url]

### This package provides long-term support for Chokidar at major version 1.

This in turn provides <a href="https://github.com/electric-eloquence/gulp#readme" target="_blank">
long-term support for gulp at major version 3</a>.

## Install

```shell
npm install --save @electric-eloquence/chokidar
```

## Use

```javascript
var chokidar = require('@electric-eloquence/chokidar');
```

## Why Chokidar?

Node.js `fs.watch`:

* Doesn't report filenames on OS X.
* Doesn't report events at all when using editors like Sublime on OS X.
* Often reports events twice.
* Emits most changes as `rename`.
* Has [a lot of other issues](https://github.com/nodejs/node/search?q=fs.watch&type=Issues)
* Does not provide an easy way to recursively watch file trees.

Node.js `fs.watchFile`:

* Almost as bad at event handling.
* Also does not provide any recursive watching.
* Results in high CPU utilization.

Chokidar resolves these problems.

## How?

Chokidar does still rely on the Node.js core `fs` module, but when using
`fs.watch` and `fs.watchFile` for watching, it normalizes the events it
receives, often checking for truth by getting file stats and/or dir contents.

On Mac OS X, chokidar by default uses a native extension exposing the Darwin
`FSEvents` API. This provides very efficient recursive watching compared with
implementations like `kqueue` available on most \*nix platforms.

On other platforms, the `fs.watch`-based implementation is the default, which
avoids polling and keeps CPU usage down. Be advised that chokidar will initiate
watchers recursively for everything within scope of the paths that have been
specified, so be judicious about not wasting system resources by watching much
more than needed.

## Getting Started

Install with npm:

    npm install @electric-eloquence/chokidar --save

Then `require` and use it in your code:

```javascript
var chokidar = require('@electric-eloquence/chokidar');

// One-liner for current directory.
chokidar.watch('.').on('all', (type, event) => {
  console.log(type, event);
});
```

```javascript
// Example of a more typical implementation structure:

// Initialize watcher.
var watcher = chokidar.watch('file, dir, glob, or array', {
  persistent: true
});

// Something to use when events are received.
var log = console.log.bind(console);
// Add event listeners.
watcher
  .on(
    'add',
    event => log(`File ${event.path} had a ${event.type} event`)
  )
  .on(
    'change',
    event => log(`File ${event.path} had a ${event.type} event`)
  )
  .on(
    'unlink',
    event => log(`File ${event.path} had a ${event.type} event`)
  );

// More possible events.
watcher
  .on(
    'addDir',
    event => log(`Directory ${event.path} had a ${event.type} event`)
  )
  .on(
    'unlinkDir',
    event => log(`Directory ${event.path} had a ${event.type} event`)
  )
  .on(
    'error',
    error => log(`Watcher error: ${error}`)
  )
  .on(
    'ready',
    () => log('Initial scan complete. Ready for changes')
  )
  .on(
    'raw',
    (event, path, details) => {
      log('Raw event info:', event, path, details);
    }
  );

// 'add', 'addDir' and 'change' events also receive stat() results as
// second argument when available:
// http://nodejs.org/api/fs.html#fs_class_fs_stats
watcher.on('change', (event, stats) => {
  if (stats) {
    console.log(`File ${event.path} had a ${event.type} event:`);
    console.log(`size to ${stats.size}`);
  }
});

// Watch new files.
watcher.add('new-file');
watcher.add(['new-file-2', 'new-file-3', '**/other-file*']);

// Get list of actual paths being watched on the filesystem.
var watchedPaths = watcher.getWatched();

// Un-watch some files.
watcher.unwatch('new-file*');

// Stop watching.
watcher.close();

// Full list of options. See below for descriptions.
// (Do not use this example.)
chokidar.watch('file', {
  persistent: true,

  ignored: '*.txt',
  ignoreInitial: false,
  followSymlinks: true,
  cwd: '.',
  disableGlobbing: false,

  usePolling: true,
  interval: 100,
  binaryInterval: 300,
  useFsEvents: false,
  alwaysStat: false,
  depth: 99,
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 100
  },

  ignorePermissionErrors: false,
  atomic: true, // or a custom delay in milliseconds (default 100)
  ignoreTmpFiles: true
});

```

## API

`chokidar.watch(paths, [options])`

* `paths` (string or array of strings). Paths to files, dirs to be watched
  recursively, or glob patterns.
* `options` (object) Options object as defined below:

#### Persistence

* `persistent` (default: `true`). Indicates whether the process should continue
  to run as long as files are being watched. If set to `false` when using
  `fsevents` to watch, no more events will be emitted after `ready`, even if the
  process continues to run.

#### Path Filtering

* `ignored` ([anymatch](https://github.com/es128/anymatch)-compatible definition)
  Defines files/paths to be ignored. The whole relative or absolute path is
  tested, not just filename. If a function with two arguments is provided, it
  gets called twice per path - once with a single argument (the path), second
  time with two arguments (the path and the
  [`fs.Stats`](http://nodejs.org/api/fs.html#fs_class_fs_stats) object of that
  path).
* `ignoreInitial` (default: `false`). If set to `false` then `add`/`addDir`
  events are also emitted for matching paths while instantiating the watching as
  chokidar discovers these file paths (before the `ready` event).
* `followSymlinks` (default: `true`). When `false`, only the symlinks themselves
  will be watched for changes instead of following the link references and
  bubbling events through the link's path.
* `cwd` (no default). The base directory from which watch `paths` are to be
  derived. Paths emitted with events will be relative to this.
* `disableGlobbing` (default: `false`). If set to `true` then the strings passed
  to `.watch()` and `.add()` are treated as literal path names, even if they
  look like globs.

#### Performance

* `usePolling` (default: `false`). Whether to use fs.watchFile (backed by
  polling), or fs.watch. If polling leads to high CPU utilization, consider
  setting this to `false`. It is typically necessary to **set this to `true` to
  successfully watch files over a network**, and it may be necessary to
  successfully watch files in other non-standard situations. Setting to `true`
  explicitly on OS X overrides the `useFsEvents` default. You may also set the
  CHOKIDAR_USEPOLLING env variable to true (1) or false (0) in order to override
  this option.
* _Polling-specific settings_ (effective when `usePolling: true`)
  * `interval` (default: `100`). Interval of file system polling. You may also
    set the CHOKIDAR_INTERVAL env variable to override this option.
  * `binaryInterval` (default: `300`). Interval of file system polling for
    binary files.
    ([see list of binary extensions](https://github.com/sindresorhus/binary-extensions/blob/master/binary-extensions.json))
* `useFsEvents` (default: `true` on OS X). Whether to use the `fsevents`
  watching interface if available. When set to `true` explicitly and `fsevents`
  is available this supercedes the `usePolling` setting. When set to `false` on
  OS X, `usePolling: true` becomes the default.
* `alwaysStat` (default: `false`). If relying upon the
  [`fs.Stats`](http://nodejs.org/api/fs.html#fs_class_fs_stats) object that may
  get passed with `add`, `addDir`, and `change` events, set this to `true` to
  ensure it is provided even in cases where it wasn't already available from the
  underlying watch events.
* `depth` (default: `undefined`). If set, limits how many levels of
  subdirectories will be traversed.
* `awaitWriteFinish` (default: `false`). By default, the `add` event will fire
  when a file first appears on disk, before the entire file has been written.
  Furthermore, in some cases some `change` events will be emitted while the file
  is being written. In some cases, especially when watching for large files
  there will be a need to wait for the write operation to finish before
  responding to a file creation or modification. Setting `awaitWriteFinish` to
  `true` (or a truthy value) will poll file size, holding its `add` and `change`
  events until the size does not change for a configurable amount of time. The
  appropriate duration setting is heavily dependent on the OS and hardware. For
  accurate detection this parameter should be relatively high, making file
  watching much less responsive. Use with caution.
  * _`options.awaitWriteFinish` can be set to an object in order to adjust
    timing params:_
  * `awaitWriteFinish.stabilityThreshold` (default: 2000). Amount of time in
    milliseconds for a file size to remain constant before emitting its event.
  * `awaitWriteFinish.pollInterval` (default: 100). File size polling interval.

#### Errors

* `ignorePermissionErrors` (default: `false`). Indicates whether to watch files
  that don't have read permissions if possible. If watching fails due to `EPERM`
  or `EACCES` with this set to `true`, the errors will be suppressed silently.
* `atomic` (default: `false`). Automatically filters out artifacts that occur
  when using editors that use "atomic saves" instead of saving directly to the
  source file. If a file is re-added within 100 ms of being deleted, Chokidar
  emits a `change` event rather than `unlink` then `add`. If the default of 100
  ms does not work well for you, you can override it by setting `atomic` to a
  custom value, in milliseconds.
* `ignoreTmpFiles` (default: `true`). Ignores editor artifacts filtered by the
  non-false `atomic` option, but without any delay. Specifically ignores the
  `.swp` and `~` extensions, and filenames with a `.subl` substring and `.tmp`
  extension. The `atomic` option is less useful these days since the Sublime
  editor was the primary culprit for atomic saves, and
  [atomic saves are now off by default](http://docs.sublimetext.info/en/latest/reference/settings.html#file-and-directory-settings).

### Methods & Events

`chokidar.watch()` produces an instance of `FSWatcher`. Methods of `FSWatcher`:

* `.add(path / paths)`: Add files, directories, or glob patterns for tracking.
  Takes an array of strings or just one string.
* `.on(event, callback)`: Listen for an FS event. Available events: `add`,
  `addDir`, `change`, `unlink`, `unlinkDir`, `ready`, `raw`, `error`.
  Additionally `all` is available which gets emitted with the underlying event
  name and path for every event other than `ready`, `raw`, and `error`.
* `.unwatch(path / paths)`: Stop watching files, directories, or glob patterns.
  Takes an array of strings or just one string.
* `.close()`: Removes all listeners from watched files.
* `.getWatched()`: Returns an object representing all the paths on the file
  system being watched by this `FSWatcher` instance. The object's keys are all
  the directories (using absolute paths unless the `cwd` option was used), and
  the values are arrays of the names of the items contained in each directory.
* `.lastEvent`: An object with two properties: `.type` and `.path`, both
  describing the last emitted event.

## Troubleshooting Installation

* `npm ERR! code EINTEGRITY`
  * If npm warns that the tarball seems to be corrupted, delete your
    package-lock.json, and install again.

* `npm WARN optional dep failed, continuing fsevents@n.n.n`
  * This message is normal part of how `npm` handles optional dependencies and
    is not indicative of a problem. Even if accompanied by other related error
    messages, Chokidar should function properly.

* `ERR! stack Error: Python executable "python" is v3.4.1, which is not
  supported by gyp.`
  * You should be able to resolve this by installing python 2.7 and running:
    `npm config set python python2.7`

* `gyp ERR! stack Error: not found: make`
  * On Mac, install the XCode command-line tools

## Acknowledgments

This package is forked from 
[an upstream source](https://github.com/paulmillr/chokidar) with the same name. 
This fork is purely derivative and does not add functionality. Credit and 
gratitude is due for 
[the contributors to the source](https://github.com/paulmillr/chokidar/graphs/contributors). 
It is our intent to work in their favor by maintaining an older version of their 
project, which may otherwise be too burdensome for them to commit time to.

[snyk-image]: https://snyk.io/test/github/electric-eloquence/chokidar/v1-lts/badge.svg
[snyk-url]: https://snyk.io/test/github/electric-eloquence/chokidar/v1-lts

[travis-image]: https://img.shields.io/travis/electric-eloquence/chokidar.svg?label=mac%20%26%20linux
[travis-url]: https://travis-ci.org/electric-eloquence/chokidar

[appveyor-image]: https://img.shields.io/appveyor/ci/e2tha-e/chokidar.svg?label=windows
[appveyor-url]: https://ci.appveyor.com/project/e2tha-e/chokidar

[coveralls-image]: https://coveralls.io/repos/github/electric-eloquence/chokidar/badge.svg?branch=v1-lts
[coveralls-url]: https://coveralls.io/github/electric-eloquence/chokidar?branch=v1-lts

[version-image]: https://img.shields.io/node/v/@electric-eloquence/chokidar.svg

[license-image]: https://img.shields.io/github/license/electric-eloquence/chokidar.svg
[license-url]: https://raw.githubusercontent.com/electric-eloquence/chokidar/v1-lts/LICENSE
