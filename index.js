'use strict';

var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var sysPath = require('path');

var asyncEach = require('async-each');
var anymatch = require('anymatch');
var isGlob = require('is-glob');
var inherits = require('inherits');
var slash = require('slash');

var NodeFsHandler = require('./lib/nodefs-handler');
var FsEventsHandler = require('./lib/fsevents-handler');

var slashStringOrArray = function(stringOrArray) {
  var slashed;
  if (typeof stringOrArray === 'string') {
    slashed = slash(stringOrArray);
  } else if (Array.isArray(stringOrArray)) {
    slashed = [];
    for (var i = 0; i < stringOrArray.length; i++) {
      if (typeof stringOrArray[i] === 'string') {
        slashed.push(slash(stringOrArray[i]));
      } else {
        slashed.push(stringOrArray[i]);
      }
    }
  } else {
    /* istanbul ignore next */
    slashed = stringOrArray;
  }
  return slashed;
};

var anymatchSlashed = function() {
  var argsNew = [];
  if (arguments[0]) {
    argsNew[0] = slashStringOrArray(arguments[0]);
  }
  if (arguments[1]) {
    argsNew[1] = slashStringOrArray(arguments[1]);
  }
  /* istanbul ignore if */
  if (arguments.length > 2) {
    for (var i = 2; i < arguments.length; i++) {
      argsNew.push(arguments[i]);
    }
  }
  return anymatch.apply(null, argsNew, {strictSlashes: true});
};

var arrify = function(value) {
  if (typeof value === 'undefined') return [];
  return Array.isArray(value) ? value : [value];
};

var flatten = function(list, result_) {
  var result = result_ || [];
  list.forEach(function(item) {
    if (Array.isArray(item)) {
      flatten(item, result);
    } else {
      result.push(item);
    }
  });
  return result;
};

// Little isString util for use in Array#every.
var isString = function(thing) {
  return typeof thing === 'string';
};

// Public: Main class.
// Watches files & directories for changes.
//
// * _opts - object, chokidar options hash
//
// Emitted events:
// `add`, `addDir`, `change`, `unlink`, `unlinkDir`, `all`, `error`
//
// Examples
//
//  var watcher = new FSWatcher()
//    .add(directories)
//    .on('add', path => console.log('File', path, 'was added'))
//    .on('change', path => console.log('File', path, 'was changed'))
//    .on('unlink', path => console.log('File', path, 'was removed'))
//    .on('all', (event, path) => console.log(path, ' emitted ', event))
//
function FSWatcher(_opts) {
  EventEmitter.call(this);
  var opts = {};
  // in case _opts that is passed in is a frozen object
  // eslint-disable-next-line guard-for-in
  if (_opts) for (var opt in _opts) opts[opt] = _opts[opt];
  this._watched = Object.create(null);
  this._closers = Object.create(null);
  this._ignoredPaths = Object.create(null);
  Object.defineProperty(this, '_globIgnored', {
    get: function() { return Object.keys(this._ignoredPaths); }
  });
  this.closed = false;
  this.lastEvent = Object.create(null);
  this._throttled = Object.create(null);
  this._symlinkPaths = Object.create(null);

  function undef(key) {
    return typeof opts[key] === 'undefined';
  }

  // Set up default options.
  if (undef('persistent')) opts.persistent = true;
  if (undef('ignoreInitial')) opts.ignoreInitial = false;
  if (undef('ignorePermissionErrors')) opts.ignorePermissionErrors = false;
  if (undef('interval')) opts.interval = 100;
  if (undef('binaryInterval')) opts.binaryInterval = 300;
  if (undef('disableGlobbing')) opts.disableGlobbing = false;
  this.enableBinaryInterval = opts.binaryInterval !== opts.interval;

  // If we can't use fsevents, ensure the options reflect it's disabled.
  /* istanbul ignore next */
  if (!FsEventsHandler.canUse()) {
    opts.useFsEvents = false;

  // Enable fsevents on OS X when polling isn't explicitly enabled.
  } else if (undef('useFsEvents')) {
    opts.useFsEvents = !opts.usePolling;
  }

  // Use polling on Mac if not using fsevents.
  // Other platforms use non-polling fs.watch.
  /* istanbul ignore if */
  if (undef('usePolling') && !opts.useFsEvents) {
    opts.usePolling = process.platform === 'darwin';
  }

  // Global override (useful for end-developers that need to force polling for all
  // instances of chokidar, regardless of usage/dependency depth)
  var envPoll = process.env.CHOKIDAR_USEPOLLING;
  if (typeof envPoll !== 'undefined') {
    var envLower = envPoll.toLowerCase();

    if (envLower === 'false' || envLower === '0') {
      opts.usePolling = false;
    } else if (envLower === 'true' || envLower === '1') {
      opts.usePolling = true;
    } else {
      opts.usePolling = Boolean(envLower);
    }
  }
  var envInterval = process.env.CHOKIDAR_INTERVAL;
  if (envInterval) {
    opts.interval = parseInt(envInterval);
  }

  if (undef('ignoreTmpFiles')) opts.ignoreTmpFiles = true;
  if (opts.atomic) this._pendingUnlinks = Object.create(null);

  if (undef('followSymlinks')) opts.followSymlinks = true;

  if (undef('awaitWriteFinish')) opts.awaitWriteFinish = false;
  if (opts.awaitWriteFinish === true) opts.awaitWriteFinish = {};
  var awf = opts.awaitWriteFinish;
  if (awf) {
    if (!awf.stabilityThreshold) awf.stabilityThreshold = 2000;
    if (!awf.pollInterval) awf.pollInterval = 100;

    this._pendingWrites = Object.create(null);
  }

  this._isntIgnored = function(path, stat) {
    return !this._isIgnored(path, stat);
  }.bind(this);

  var readyCalls = 0;
  this._emitReady = function() {
    if (++readyCalls >= this._readyCount) {
      this._emitReady = Function.prototype;
      this._readyEmitted = true;
      // use process.nextTick to allow time for listener to be bound
      process.nextTick(this.emit.bind(this, 'ready'));
    }
  }.bind(this);

  this.options = opts;

  // You’re frozen when your heart’s not open.
  Object.freeze(opts);
}

inherits(FSWatcher, EventEmitter);

// Common helpers
// --------------

// Private method: Normalize and emit events
//
// * event_    - string, type of event
// * path_     - string, file or directory path
// * val[1..3] - arguments to be passed with event
//
// Returns the error if defined, otherwise the value of the
// FSWatcher instance's `closed` flag
FSWatcher.prototype._emit = function(event_, path_, val1, val2, val3) {
  var event = event_;
  var path = path_;
  this.lastEvent.type = event;
  this.lastEvent.path = path;
  var cwd = this.options.cwd;

  if (cwd) path = sysPath.relative(cwd, path);
  var args = [event, path];
  if (typeof val3 !== 'undefined') args.push(val1, val2, val3);
  else if (typeof val2 !== 'undefined') args.push(val1, val2);
  else if (typeof val1 !== 'undefined') args.push(val1);

  var awf = this.options.awaitWriteFinish;
  if (awf && this._pendingWrites[path]) {
    this._pendingWrites[path].lastChange = new Date();
    return this;
  }

  /* istanbul ignore if */
  if (this.options.atomic) {
    if (event === 'unlink') {
      this._pendingUnlinks[path] = args;
      setTimeout(
        function() {
          Object.keys(this._pendingUnlinks).forEach(function(_path) {
            var argsEmit = this._pendingUnlinks[_path].slice(0);
            if (argsEmit[0] === event && argsEmit[1] === _path) {
              var fullPath = cwd ? sysPath.join(cwd, _path) : _path;
              // Dereference from this.lastEvent
              argsEmit[1] = {type: argsEmit[0], path: fullPath};
            }
            this.emit.apply(this, argsEmit);
            this.emit.apply(this, ['all'].concat(argsEmit));
            delete this._pendingUnlinks[_path];
          }.bind(this));
        }.bind(this),
        typeof this.options.atomic === 'number' ? this.options.atomic : 100
      );
      return this;
    } else if (event === 'add' && this._pendingUnlinks[path]) {
      event = args[0] = 'change';
      delete this._pendingUnlinks[path];
    }
  }

  var emitEvent = function() {
    var argsEmit = args.slice(0);
    if (argsEmit[1] === path) {
      // Dereference from this.lastEvent
      argsEmit[1] = JSON.parse(JSON.stringify(this.lastEvent));
    }
    this.emit.apply(this, argsEmit);
    if (event !== 'error') this.emit.apply(this, ['all'].concat(argsEmit));
  }.bind(this);

  if (awf && (event === 'add' || event === 'change') && this._readyEmitted) {
    var awfEmit = function(err, stats) {
      /* istanbul ignore if */
      if (err) {
        event = args[0] = 'error';
        args[1] = err;
        emitEvent();
      } else if (stats) {
        // if stats doesn't exist the file must have been deleted
        if (args.length > 2) {
          args[2] = stats;
        } else {
          args.push(stats);
        }
        emitEvent();
      }
    };

    this._awaitWriteFinish(path, awf.stabilityThreshold, event, awfEmit);
    return this;
  }

  if (event === 'change') {
    if (!this._throttle('change', path, 50)) return this;
  }

  if (
    this.options.alwaysStat && typeof val1 === 'undefined' &&
    (event === 'add' || event === 'addDir' || event === 'change')
  ) {
    var fullPath = cwd ? sysPath.join(cwd, path) : path;
    fs.stat(fullPath, function(error, stats) {
      // Suppress event when fs.stat fails, to avoid sending undefined 'stat'
      if (error || !stats) return;

      args.push(stats);
      emitEvent();
    });
  } else {
    emitEvent();
  }

  return this;
};

// Private method: Common handler for errors
//
// * error - object, Error instance
//
// Returns the error if defined, otherwise the value of the
// FSWatcher instance's `closed` flag
FSWatcher.prototype._handleError = function(error) {
  var code = error && error.code;
  var ipe = this.options.ignorePermissionErrors;
  /* istanbul ignore if */
  if (error &&
    code !== 'ENOENT' &&
    code !== 'ENOTDIR' &&
    (!ipe || (code !== 'EPERM' && code !== 'EACCES'))
  ) this.emit('error', error);
  return error || this.closed;
};

// Private method: Helper utility for throttling
//
// * action  - string, type of action being throttled
// * path    - string, path being acted upon
// * timeout - int, duration of time to suppress duplicate actions
//
// Returns throttle tracking object or false if action should be suppressed
FSWatcher.prototype._throttle = function(action, path, timeout) {
  if (!(action in this._throttled)) {
    this._throttled[action] = Object.create(null);
  }
  var throttled = this._throttled[action];
  if (path in throttled) {
    throttled[path].count++;
    return false;
  }
  var timeoutObject;
  function clear() {
    var count = throttled[path] ? throttled[path].count : 0;
    delete throttled[path];
    clearTimeout(timeoutObject);
    return count;
  }
  timeoutObject = setTimeout(clear, timeout);
  throttled[path] = {timeoutObject: timeoutObject, clear: clear, count: 0};
  return throttled[path];
};

// Private method: Awaits write operation to finish
//
// * path      - string, path being acted upon
// * threshold - int, time in milliseconds a file size must be fixed before
//               acknowledging write operation is finished
// * awfEmit   - function, to be called when ready for event to be emitted
// Polls a newly created file for size variations. When files size does not
// change for 'threshold' milliseconds calls callback.
FSWatcher.prototype._awaitWriteFinish = function(path, threshold, event, awfEmit) {
  var timeoutHandler;

  var fullPath = path;
  if (this.options.cwd && !sysPath.isAbsolute(path)) {
    fullPath = sysPath.join(this.options.cwd, path);
  }

  var now = new Date();

  var awaitWriteFinish = (function(prevStat) {
    fs.stat(fullPath, function(err, curStat) {
      /* istanbul ignore if */
      if (err || !(path in this._pendingWrites)) {
        if (err && err.code !== 'ENOENT') awfEmit(err);
        return;
      }

      var now = new Date();

      if (prevStat && curStat.size !== prevStat.size) {
        this._pendingWrites[path].lastChange = now;
      }

      if (now - this._pendingWrites[path].lastChange >= threshold) {
        delete this._pendingWrites[path];
        awfEmit(null, curStat);
      } else {
        timeoutHandler = setTimeout(
          awaitWriteFinish.bind(this, curStat),
          this.options.awaitWriteFinish.pollInterval
        );
      }
    }.bind(this));
  }.bind(this));

  if (!(path in this._pendingWrites)) {
    this._pendingWrites[path] = {
      lastChange: now,
      cancelWait: function() {
        delete this._pendingWrites[path];
        clearTimeout(timeoutHandler);
        return event;
      }.bind(this)
    };
    timeoutHandler = setTimeout(
      awaitWriteFinish.bind(this),
      this.options.awaitWriteFinish.pollInterval
    );
  }
};

// Private method: Determines whether user has asked to ignore this path
//
// * path  - string, path to file or directory
// * stats - object, result of fs.stat
//
// Returns boolean
var dotRe = /\..*\.swp$|~$|\.subl.*\.tmp$/;
FSWatcher.prototype._isIgnored = function(path, stats) {
  if (dotRe.test(path)) {
    if (this.options.atomic || this.options.ignoreTmpFiles) {
      return true;
    }
  }

  if (!this._userIgnored) {
    var cwd = this.options.cwd;
    var ignored;
    if (cwd) {
      ignored = arrify(this.options.ignored).map(function(path) {
        if (typeof path !== 'string') return path;
        return sysPath.isAbsolute(path) ? path : sysPath.join(cwd, path);
      });
    } else {
      ignored = arrify(this.options.ignored);
    }
    var paths = ignored.filter(function(path) {
      return typeof path === 'string' && !isGlob(slash(path));
    }).map(function(path) {
      return path + '/**';
    });
    this._userIgnored = anymatchSlashed(
      this._globIgnored.concat(ignored).concat(paths)
    );
  }

  return this._userIgnored([path, stats]);
};

// Private method: Provides a set of common helpers and properties relating to
// symlink and glob handling
//
// * path_ - string, file, directory, or glob pattern being watched
// * depth - int, at any depth > 0, this isn't a glob
//
// Returns object containing helpers for this path
// eslint-disable-next-line no-useless-escape
var replacerRe = /^\.[\/\\]/;
FSWatcher.prototype._getWatchHelpers = function(path_, depth) {
  var follow = this.options.followSymlinks;
  var path = path_.replace(replacerRe, '');
  var watchPath = path;

  // flip windows path separators where backslashes are not intentional escape characters
  if (process.platform === 'win32' && path.indexOf('/') === -1) {
    path = slash(path);
  }

  if (!depth && !this.options.disableGlobbing && isGlob(path)) {
    var globParent = '';
    var globSplit = path.split('/');
    for (var i = 0; i < globSplit.length; i++) {
      if (isGlob(globSplit[i])) {
        break;
      } else {
        globParent += globSplit[i] + '/';
      }
    }
    watchPath = globParent || './';
  }

  var fullWatchPath = sysPath.resolve(watchPath);
  var hasGlob = watchPath !== path;
  var globFilter = hasGlob ? anymatchSlashed(path) : false;
  var globSymlink = hasGlob && follow ? null : false;

  var checkGlobSymlink = function(entry) {
    // only need to resolve once
    // first entry should always have entry.parentDir === ''
    if (globSymlink === null) {
      globSymlink = entry.fullParentDir === fullWatchPath ? false : {
        realPath: entry.fullParentDir,
        linkPath: fullWatchPath
      };
    }

    if (globSymlink) {
      return entry.fullPath.replace(globSymlink.realPath, globSymlink.linkPath);
    }

    return entry.fullPath;
  };

  var entryPath = function(entry) {
    return sysPath.join(watchPath,
      sysPath.relative(watchPath, checkGlobSymlink(entry))
    );
  };

  var getDirParts = function(_path) {
    if (!hasGlob) return false;
    // eslint-disable-next-line no-useless-escape
    var parts = sysPath.relative(watchPath, _path).split(/[\/\\]/);
    return parts;
  };

  var dirParts = getDirParts(path);
  if (dirParts && dirParts.length > 1) dirParts.pop();

  var unmatchedGlob;
  var filterDir = function(entry) {
    if (hasGlob) {
      var entryParts = getDirParts(checkGlobSymlink(entry));
      var globstar = false;
      unmatchedGlob = !dirParts.every(function(part, i) {
        if (part === '**') globstar = true;
        return globstar || !entryParts[i] || anymatchSlashed(part, entryParts[i]);
      });
    }
    return !unmatchedGlob && this._isntIgnored(entryPath(entry), entry.stats);
  }.bind(this);

  var filterPath = function(entry) {
    if (entry.stats && entry.stats.isSymbolicLink()) {
      return filterDir(entry);
    }
    var resolvedPath = entryPath(entry);
    return (!hasGlob || globFilter(resolvedPath)) &&
      this._isntIgnored(resolvedPath, entry.stats) &&
      (this.options.ignorePermissionErrors || this._hasReadPermissions(entry.stats));
  }.bind(this);

  return {
    followSymlinks: follow,
    statMethod: follow ? 'stat' : 'lstat',
    path: path,
    watchPath: watchPath,
    entryPath: entryPath,
    hasGlob: hasGlob,
    globFilter: globFilter,
    filterPath: filterPath,
    filterDir: filterDir
  };
};

// Directory helpers
// -----------------

// Private method: Provides directory tracking objects
//
// * directory - string, path of the directory
//
// Returns the directory's tracking object
FSWatcher.prototype._getWatchedDir = function(directory) {
  var dir = sysPath.resolve(directory);
  var watcherRemove = this._remove.bind(this);
  if (!(dir in this._watched)) this._watched[dir] = {
    _items: Object.create(null),
    add: function(item) {
      if (item !== '.' && item !== '..') this._items[item] = true;
    },
    remove: function(item) {
      delete this._items[item];
      if (!this.children().length) {
        fs.readdir(dir, function(err) {
          if (err) watcherRemove(sysPath.dirname(dir), sysPath.basename(dir));
        });
      }
    },
    has: function(item) {return item in this._items;},
    children: function() {return Object.keys(this._items);}
  };
  return this._watched[dir];
};

// File helpers
// ------------

// Private method: Check for read permissions
// Based on this answer on SO: http://stackoverflow.com/a/11781404/1358405
//
// * stats - object, result of fs.stat
//
// Returns boolean
FSWatcher.prototype._hasReadPermissions = function(stats) {
  if (this.options.ignorePermissionErrors) return true;

  // stats.mode may be bigint
  var md = stats && Number.parseInt(stats.mode, 10);
  var st = md & parseInt('777', 8);
  var it = Number.parseInt(st.toString(8)[0], 10);
  return Boolean(4 & it);
};

// Private method: Handles emitting unlink events for
// files and directories, and via recursion, for
// files and directories within directories that are unlinked
//
// * directory - string, directory within which the following item is located
// * item      - string, base path of item/directory
//
// Returns nothing
FSWatcher.prototype._remove = function(directory, item) {
  // if what is being deleted is a directory, get that directory's paths
  // for recursive deleting and cleaning of watched object
  // if it is not a directory, nestedDirectoryChildren will be empty array
  var path = sysPath.join(directory, item);
  var fullPath = sysPath.resolve(path);
  var isDirectory = this._watched[path] || this._watched[fullPath];

  // prevent duplicate handling in case of arriving here nearly simultaneously
  // via multiple paths (such as _handleFile and _handleDir)
  if (!this._throttle('remove', path, 100)) return;

  // if the only watched file is removed, watch for its return
  var watchedDirs = Object.keys(this._watched);
  if (!isDirectory && !this.options.useFsEvents && watchedDirs.length === 1) {
    this.add(directory, item, true);
  }

  // This will create a new entry in the watched object in either case
  // so we got to do the directory check beforehand
  var nestedDirectoryChildren = this._getWatchedDir(path).children();

  // Recursively remove children directories / files.
  nestedDirectoryChildren.forEach(function(nestedItem) {
    this._remove(path, nestedItem);
  }, this);

  // Check if item was on the watched list and remove it
  var parent = this._getWatchedDir(directory);
  var wasTracked = parent.has(item);
  parent.remove(item);

  // If we wait for this file to be fully written, cancel the wait.
  var relPath = path;
  if (this.options.cwd) relPath = sysPath.relative(this.options.cwd, path);
  if (this.options.awaitWriteFinish && this._pendingWrites[relPath]) {
    var event = this._pendingWrites[relPath].cancelWait();
    if (event === 'add') return;
  }

  // The Entry will either be a directory that just got removed
  // or a bogus entry to a file, in either case we have to remove it
  delete this._watched[path];
  delete this._watched[fullPath];
  var eventName = isDirectory ? 'unlinkDir' : 'unlink';
  if (wasTracked && !this._isIgnored(path)) this._emit(eventName, path);

  // Avoid conflicts if we later create another file with the same name
  if (!this.options.useFsEvents) {
    this._closePath(path);
  }
};

FSWatcher.prototype._closePath = function(path) {
  if (!this._closers[path]) return;
  this._closers[path]();
  delete this._closers[path];
  this._getWatchedDir(sysPath.dirname(path)).remove(sysPath.basename(path));
};

// Public method: Adds paths to be watched on an existing FSWatcher instance

// * paths     - string or array of strings, file/directory paths and/or globs
// * _origAdd  - private boolean, for handling non-existent paths to be watched
// * _internal - private boolean, indicates a non-user add

// Returns an instance of FSWatcher for chaining.
FSWatcher.prototype.add = function(paths, _origAdd, _internal) {
  var cwd = this.options.cwd;
  this.closed = false;
  // To avoid reassignment of a function param, assign to a different varname
  // Using "paths" (without underscore) as the function param to avoid confusion
  // as to what the underscore means when exposing this public method via API
  // The internal var will be named with the underscore
  var _paths = flatten(arrify(paths));

  if (!_paths.every(isString)) {
    throw new TypeError('Non-string provided as watch path: ' + _paths);
  }

  if (cwd) _paths = _paths.map(function(path) {
    var absPath;
    if (sysPath.isAbsolute(path)) {
      absPath = path;
    } else if (path[0] === '!') {
      absPath = '!' + sysPath.join(cwd, path.substring(1));
    } else {
      absPath = sysPath.join(cwd, path);
    }

    return absPath;
  });

  // set aside negated glob strings
  _paths = _paths.filter(function(path) {
    if (path[0] === '!') {
      this._ignoredPaths[path.substring(1)] = true;
    } else {
      // if a path is being added that was previously ignored, stop ignoring it
      delete this._ignoredPaths[path];
      delete this._ignoredPaths[path + '/**'];

      // reset the cached userIgnored anymatch fn
      // to make ignoredPaths changes effective
      this._userIgnored = null;

      return true;
    }
  }, this);

  if (this.options.useFsEvents && FsEventsHandler.canUse()) {
    if (!this._readyCount) this._readyCount = _paths.length;
    if (this.options.persistent) this._readyCount *= 2;
    _paths.forEach(this._addToFsEvents, this);
  } else {
    if (!this._readyCount) this._readyCount = 0;
    this._readyCount += _paths.length;
    var chokidarInstance = this;
    asyncEach(_paths, function(path, next) {
      this._addToNodeFs(path, !_internal, 0, 0, chokidarInstance, _origAdd, function(err, res) {
        if (res) this._emitReady();
        next(err, res);
      }.bind(this));
    }.bind(this), function(error, results) {
      results.forEach(function(item) {
        if (!item || this.closed) return;
        this.add(sysPath.dirname(item), sysPath.basename(_origAdd || item));
      }, this);
    }.bind(this));
  }

  return this;
};

// Public method: Close watchers or start ignoring events from specified paths.

// * paths - string or array of strings, file/directory paths and/or globs

// Returns instance of FSWatcher for chaining.
FSWatcher.prototype.unwatch = function(paths) {
  if (this.closed) return this;

  // To avoid reassignment of a function param, assign to a different varname
  // Using "paths" (without underscore) as the function param to avoid confusion
  // as to what the underscore means when exposing this public method via API
  // The internal var will be named with the underscore
  var _paths = flatten(arrify(paths));
  _paths.forEach(function(path_) {
    // convert to absolute path unless relative path already matches
    var path = path_;
    if (!sysPath.isAbsolute(path) && !this._closers[path]) {
      if (this.options.cwd) path = sysPath.join(this.options.cwd, path);
      path = sysPath.resolve(path);
    }

    this._closePath(path);

    this._ignoredPaths[path] = true;
    if (path in this._watched) {
      this._ignoredPaths[path + '/**'] = true;
    }

    // reset the cached userIgnored anymatch fn
    // to make ignoredPaths changes effective
    this._userIgnored = null;
  }, this);

  return this;
};

// Public method: Close watchers and remove all listeners from watched paths.

// Returns instance of FSWatcher for chaining.
FSWatcher.prototype.close = function() {
  if (this.closed) return this;

  this.closed = true;
  Object.keys(this._closers).forEach(function(watchPath) {
    this._closers[watchPath]();
    delete this._closers[watchPath];
  }, this);
  this._watched = Object.create(null);

  this.removeAllListeners();
  return this;
};

// Public method: Expose list of watched paths

// Returns object w/ dir paths as keys and arrays of contained paths as values.
FSWatcher.prototype.getWatched = function() {
  var watchList = {};
  Object.keys(this._watched).forEach(function(dir) {
    var key = this.options.cwd ? sysPath.relative(this.options.cwd, dir) : dir;
    watchList[key || '.'] = Object.keys(this._watched[dir]._items).sort();
  }.bind(this));
  return watchList;
};

// Attach watch handler prototype methods
function importHandler(handler) {
  Object.keys(handler.prototype).forEach(function(method) {
    FSWatcher.prototype[method] = handler.prototype[method];
  });
}
importHandler(NodeFsHandler);
if (FsEventsHandler.canUse()) importHandler(FsEventsHandler);

// Export FSWatcher class
exports.FSWatcher = FSWatcher;

// Public function: Instantiates watcher with paths to be tracked.

// * paths   - string or array of strings, file/directory paths and/or globs
// * options - object, chokidar options

// Returns an instance of FSWatcher for chaining.
exports.watch = function(paths, options) {
  return new FSWatcher(options).add(paths);
};
