# Chokidar Changelog

### 1.7.10
* Checking that macOS > El Capitan in FsEventsHandler.canUse instead of index.js
* Updated anymatch to major version 3
* Broad updates to dependencies

### 1.7.9
* Fixed bug that disabled fsevents for wrong macOS versions

### 1.7.8
* Disabling fsevents for macOS versions < Sierra

### 1.7.7
* Disabling fsevents for macOS versions < Sierra

### 1.7.6
* Bumped fsevents to major version 2, using Node's native N-API

### 1.7.5
* Acknowledgements in readme

### 1.7.4
* Important doc updates

### 1.7.3
* Downgrading optional dependency (Mac only) fsevents to major version 1
* Otherwise, minor maintenance and doc updates

### 1.7.2
* Better handling of renamed and removed directories
* Better handling of paths when cwd is submitted

### 1.7.1
* Continuous integration
* Bumped anymatch version to patch minor vulnerability

### 1.7.0
* Beginning of long-term support for Chokidar major version 1
* Writing event and path to FSWatcher instance on \_emit to be accessible by dependent packages
