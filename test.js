/* eslint-disable no-unused-expressions */
'use strict';

var chokidar = require('./');
var chai = require('chai');
var expect = chai.expect;
var should = chai.should(); // eslint-disable-line no-unused-vars
var sinon = require('sinon');
var rimraf = require('rimraf');
var fs = require('graceful-fs');
var sysPath = require('path');
var cp = require('child_process');
chai.use(require('sinon-chai'));
var os = require('os');
var osMajor = parseInt(os.release().split('.')[0]);
var platform = process.platform;

var mochaIt = it;
var options;
var osXFsWatch;
var slowerDelay;
var subdir = 0;
var testCount = 0;
var win32Polling;

function getFixturePath(subPath) {
  return sysPath.join(
    __dirname,
    'test-fixtures',
    subdir && subdir.toString() || '',
    subPath
  );
}

var fixturePath = getFixturePath('');

if (!fs.readFileSync(__filename).toString().match(/\sit\.only\(/)) {
  /* eslint-disable no-global-assign */
  /* eslint-disable no-native-reassign */
  it = function() {
    testCount++;
    mochaIt.apply(this, arguments);
  };
  it.skip = function() {
    testCount--;
    mochaIt.skip.apply(this, arguments);
  };
  /* eslint-enable no-global-assign */
  /* eslint-enable no-native-reassign */
}

before(function() {
  rimraf.sync(sysPath.join(__dirname, 'test-fixtures'));
  fs.mkdirSync(fixturePath);
  while (subdir < testCount) {
    subdir++;
    fixturePath = getFixturePath('');
    fs.mkdirSync(fixturePath);
    fs.writeFileSync(sysPath.join(fixturePath, 'change.txt'), 'b');
    fs.writeFileSync(sysPath.join(fixturePath, 'unlink.txt'), 'b');
  }
  subdir = 0;
});

beforeEach(function() {
  subdir++;
  fixturePath = getFixturePath('');
});

afterEach(function() {
  sinon.restore();
});

describe('chokidar', function() {
  this.timeout(6000);
  it('exposes public API methods', function() {
    chokidar.FSWatcher.should.be.a('function');
    chokidar.watch.should.be.a('function');
  });

  // Darwin major version 15 is macOS 10.11 El Capitan.
  // fsevents does not work in 10.11 El Capitan and lower.
  if (platform === 'darwin' && osMajor > 15) {
    describe('fsevents (native extension)', runTests.bind(this, {useFsEvents: true}));
  }
  describe('fs.watch (non-polling)', runTests.bind(this, {usePolling: false, useFsEvents: false}));
  describe('fs.watchFile (polling)', runTests.bind(this, {usePolling: true, interval: 10}));
});

function w(fn, to) {
  return setTimeout.bind(null, fn, to || slowerDelay || 50);
}

function runTests(baseopts) {
  baseopts.persistent = true;

  before(function() {
    // Flags for bypassing special-case test failures on CI.
    osXFsWatch = platform === 'darwin' && !baseopts.usePolling && !baseopts.useFsEvents;
    win32Polling = platform === 'win32' && baseopts.usePolling;

    if (osXFsWatch) {
      slowerDelay = 200;
    } else {
      slowerDelay = null;
    }
  });

  beforeEach(function clean() {
    options = {};
    Object.keys(baseopts).forEach(function(key) {
      options[key] = baseopts[key];
    });
  });

  function stdWatcher() {
    return chokidar.watch(fixturePath, options);
  }

  function waitFor(spies, fn_) {
    var fn = fn_;
    var intrvl;
    var to;
    function isSpyReady(spy) {
      return Array.isArray(spy) ? spy[0].callCount >= spy[1] : spy.callCount;
    }
    function finish() {
      clearInterval(intrvl);
      clearTimeout(to);
      fn();
      fn = Function.prototype;
    }
    intrvl = setInterval(function() {
      if (spies.every(isSpyReady)) finish();
    }, 5);
    to = setTimeout(finish, 3500);
  }

  function wClose(watcher) {
    watcher.close();
  }

  describe('instantiate correctly', function() {
    it('produces an instance of chokidar.FSWatcher', function() {
      var watcher = stdWatcher();
      watcher.should.be.an['instanceof'](chokidar.FSWatcher);
      wClose(watcher);
    });
    it('exposes public API methods', function() {
      var watcher = stdWatcher();
      watcher.on.should.be.a('function');
      watcher.emit.should.be.a('function');
      watcher.add.should.be.a('function');
      watcher.close.should.be.a('function');
      watcher.getWatched.should.be.a('function');
      wClose(watcher);
    });
  });
  describe('watch a directory', function() {
    var rawSpy;
    var readySpy;
    beforeEach(function() {
      options.ignoreInitial = true;
      options.alwaysStat = true;
      readySpy = sinon.spy();
      rawSpy = sinon.spy();
    });
    afterEach(function(done) {
      waitFor([readySpy], function() {
        readySpy.should.have.been.calledOnce;
        done();
      });
    });
    it('emits `add` event when file is added', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('add.txt');
      var testArg = {type: 'add', path: testPath};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('raw', rawSpy)
        .on('add', spy)
        .on('ready', w(function() {
          fs.writeFileSync(testPath, Date.now());
          waitFor([spy], function() {
            spy.should.have.been.calledOnce;
            spy.should.have.been.calledWith(testArg);
            expect(spy.args[0][1]).to.be.ok; // stats
            rawSpy.should.have.been.called;
            wClose(watcher);
            done();
          });
        }));
    });
    it('emits `addDir` event when directory is added', function(done) {
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testArg = {type: 'addDir', path: testDir};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('raw', rawSpy)
        .on('addDir', spy)
        .on('ready', w(function() {
          spy.should.not.have.been.called;
          fs.mkdirSync(testDir);
          waitFor([spy], function() {
            spy.should.have.been.calledOnce;
            spy.should.have.been.calledWith(testArg);
            expect(spy.args[0][1]).to.be.ok; // stats
            rawSpy.should.have.been.called;
            wClose(watcher);
            done();
          });
        }));
    });
    it('emits `change` event when file is changed', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('change.txt');
      var testArg = {type: 'change', path: testPath};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('raw', rawSpy)
        .on('change', spy)
        .on('ready', w(function() {
          spy.should.not.have.been.called;
          fs.writeFileSync(testPath, Date.now());
          waitFor([spy], function() {
            spy.should.have.been.calledWith(testArg);
            expect(spy.args[0][1]).to.be.ok; // stats
            rawSpy.should.have.been.called;
            spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          });
        }));
    });
    it('emits `unlink` event when file is removed', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('unlink.txt');
      var testArg = {type: 'unlink', path: testPath};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('raw', rawSpy)
        .on('unlink', spy)
        .on('ready', w(function() {
          spy.should.not.have.been.called;
          fs.unlinkSync(testPath);
          waitFor([spy], function() {
            spy.should.have.been.calledWith(testArg);
            expect(spy.args[0][1]).to.not.be.ok; // no stats
            rawSpy.should.have.been.called;
            spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          });
        }));
    });
    it('emits `unlinkDir` event when a directory is removed', function(done) {
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testArg = {type: 'unlinkDir', path: testDir};
      fs.mkdirSync(testDir);
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('raw', rawSpy)
        .on('unlinkDir', spy)
        .on('ready', w(function() {
          fs.rmdirSync(testDir);
          waitFor([spy], function() {
            spy.should.have.been.calledWith(testArg);
            expect(spy.args[0][1]).to.not.be.ok; // no stats
            rawSpy.should.have.been.called;
            spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          });
        }));
    });
    it('emits `unlink` and `add` events when a file is renamed', function(done) {
      var unlinkSpy = sinon.spy();
      var addSpy = sinon.spy();
      var testPath = getFixturePath('change.txt');
      var newPath = getFixturePath('moved.txt');
      var unlinkArg = {type: 'unlink', path: testPath};
      var addArg = {type: 'add', path: newPath};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('raw', rawSpy)
        .on('unlink', unlinkSpy)
        .on('add', addSpy)
        .on('ready', w(function() {
          unlinkSpy.should.not.have.been.called;
          addSpy.should.not.have.been.called;
          fs.renameSync(testPath, newPath);
          w(function() {
            unlinkSpy.should.have.been.calledWith(unlinkArg);
            expect(unlinkSpy.args[0][1]).to.not.be.ok; // no stats
            rawSpy.should.have.been.called;
            if (!osXFsWatch) unlinkSpy.should.have.been.calledOnce;
            if (!baseopts.usePolling) { // Polling does not reliably emit `add` event on rename.
              addSpy.should.have.been.calledOnce;
              addSpy.should.have.been.calledWith(addArg);
              expect(addSpy.args[0][1]).to.be.ok; // stats
            }
            wClose(watcher);
            done();
          }, 300)();
        }));
    });
    it('emits `unlinkDir` when a directory is renamed', function(done) {
      var unlinkDirSpy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testDir2 = getFixturePath('subdir2');
      var testFile = sysPath.join(testDir, 'add.txt');
      var testArg = {type: 'unlinkDir', path: testDir};
      fs.mkdirSync(testDir);
      fs.writeFileSync(testFile, Date.now());
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('unlinkDir', unlinkDirSpy)
        .on('ready', w(function() {
          fs.renameSync(testDir, testDir2);
          waitFor([unlinkDirSpy.withArgs(testArg)], function() {
            unlinkDirSpy.withArgs(testArg).should.have.been.calledOnce;
            wClose(watcher);
            done();
          });
        }));
    });
    if (!baseopts.useFsEvents && !baseopts.usePolling) {
      it('emits `unlinkDir` when a directory is renamed and renamed back to its original name', function(done) {
        var unlinkDirSpy = sinon.spy();
        var testDir = getFixturePath('subdir');
        var testDir2 = getFixturePath('subdir2');
        var testFile = sysPath.join(testDir, 'add.txt');
        var testArg = {type: 'unlinkDir', path: testDir};
        var testArg2 = {type: 'unlinkDir', path: testDir2};
        fs.mkdirSync(testDir);
        fs.writeFileSync(testFile, Date.now());
        var watcher = stdWatcher()
          .on('ready', readySpy)
          .on('unlinkDir', unlinkDirSpy)
          .on('ready', w(function() {
            fs.rename(testDir, testDir2, w(function() {
              fs.renameSync(testDir2, testDir);
            }));
            waitFor([unlinkDirSpy.withArgs(testArg)], function() {
              unlinkDirSpy.withArgs(testArg).should.have.been.calledOnce;
            });
            waitFor([unlinkDirSpy.withArgs(testArg2)], function() {
              unlinkDirSpy.withArgs(testArg2).should.have.been.calledOnce;
              wClose(watcher);
              done();
            });
          }));
      });
    }
    it('emits `add`, not `change`, when previously deleted file is re-added', function(done) {
      var unlinkSpy = sinon.spy();
      var addSpy = sinon.spy();
      var changeSpy = sinon.spy();
      var testPath = getFixturePath('add.txt');
      var unlinkArg = {type: 'unlink', path: testPath};
      var addArg = {type: 'add', path: testPath};
      fs.writeFileSync(testPath, 'hello');
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('unlink', unlinkSpy)
        .on('add', addSpy)
        .on('change', changeSpy)
        .on('ready', function() { // Not calling w() because it causes a `change` event to be emitted.
          fs.unlinkSync(testPath);
          waitFor([unlinkSpy.withArgs(unlinkArg)], function() {
            unlinkSpy.should.have.been.calledWith(unlinkArg);
            fs.writeFileSync(testPath, Date.now());
            waitFor([addSpy.withArgs(addArg)], function() {
              addSpy.should.have.been.calledWith(addArg);
              changeSpy.should.not.have.been.called;
              wClose(watcher);
              done();
            });
          });
        });
    });
    it('does not emit `unlink` for previously moved files', function(done) {
      var unlinkSpy = sinon.spy();
      var testPath = getFixturePath('change.txt');
      var newPath1 = getFixturePath('moved.txt');
      var newPath2 = getFixturePath('moved-again.txt');
      var testArg = {type: 'unlink', path: testPath};
      var testArg1 = {type: 'unlink', path: newPath1};
      var testArg2 = {type: 'unlink', path: newPath2};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('unlink', unlinkSpy)
        .on('ready', w(function() {
          fs.rename(testPath, newPath1, w(function() {
            fs.renameSync(newPath1, newPath2);
          }, 300));
          w(function() {
            unlinkSpy.withArgs(testArg).should.have.been.calledOnce;
            unlinkSpy.withArgs(testArg1).should.have.been.calledOnce;
            unlinkSpy.withArgs(testArg2).should.not.have.been.called;
            wClose(watcher);
            done();
          }, 1500)();
        }));
    });
    it('survives ENOENT for missing subdirectories', function(done) {
      var testDir = getFixturePath('notadir');
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('ready', function() {
          watcher.add(testDir);
          wClose(watcher);
          done();
        });
    });
    it('notices when a file appears in a new directory', function(done) {
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testPath = getFixturePath('subdir/add.txt');
      var testArg = {type: 'add', path: testPath};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('add', spy)
        .on('ready', w(function() {
          spy.should.not.have.been.called;
          fs.mkdirSync(testDir);
          fs.writeFileSync(testPath, Date.now());
          waitFor([spy], function() {
            spy.should.have.been.calledOnce;
            spy.should.have.been.calledWith(testArg);
            expect(spy.args[0][1]).to.be.ok; // stats
            wClose(watcher);
            done();
          });
        }));
    });
    it('watches removed and re-added directories', function(done) {
      var unlinkSpy = sinon.spy();
      var addSpy = sinon.spy();
      var parentPath = getFixturePath('subdir2');
      var subPath = getFixturePath('subdir2/subsub');
      var unlinkArg = {type: 'unlinkDir', path: parentPath};
      var addParentArg = {type: 'addDir', path: parentPath};
      var addSubArg = {type: 'addDir', path: subPath};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('unlinkDir', unlinkSpy)
        .on('addDir', addSpy)
        .on('ready', w(function() {
          fs.mkdir(parentPath, w(function() {
            fs.rmdirSync(parentPath);
          }, 300));
          waitFor([unlinkSpy], function() {
            unlinkSpy.should.have.been.calledWith(unlinkArg);
            fs.mkdirSync(parentPath);
            fs.mkdirSync(subPath);
            waitFor([[addSpy, 3]], function() {
              addSpy.should.have.been.calledWith(addParentArg);
              addSpy.should.have.been.calledWith(addSubArg);
              wClose(watcher);
              done();
            });
          });
        }));
    });
  });
  describe('watch individual files', function() {
    it('detects changes', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('change.txt');
      var testArg = {type: 'change', path: testPath};
      var watcher = chokidar.watch(testPath, options)
        .on('change', spy)
        .on('ready', w(function() {
          fs.writeFileSync(testPath, Date.now());
          waitFor([spy], function() {
            spy.should.have.always.been.calledWith(testArg);
            wClose(watcher);
            done();
          });
        }));
    });
    it('detects unlinks', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('unlink.txt');
      var testArg = {type: 'unlink', path: testPath};
      var watcher = chokidar.watch(testPath, options)
        .on('unlink', spy)
        .on('ready', w(function() {
          fs.unlinkSync(testPath);
          waitFor([spy], function() {
            spy.should.have.been.calledWith(testArg);
            wClose(watcher);
            done();
          });
        }));
    });
    it('detects unlink and re-add', function(done) {
      options.ignoreInitial = true;
      var unlinkSpy = sinon.spy();
      var addSpy = sinon.spy();
      var testPath = getFixturePath('unlink.txt');
      var unlinkArg = {type: 'unlink', path: testPath};
      var addArg = {type: 'add', path: testPath};
      var watcher = chokidar.watch(testPath, options)
        .on('unlink', unlinkSpy)
        .on('add', addSpy)
        .on('ready', w(function() {
          fs.unlinkSync(testPath);
          waitFor([unlinkSpy], function() {
            unlinkSpy.should.have.been.calledWith(unlinkArg);
            fs.writeFileSync(testPath, 're-added');
            waitFor([addSpy], function() {
              addSpy.should.have.been.calledWith(addArg);
              wClose(watcher);
              done();
            });
          });
        }));
    });
    it('ignores unwatched siblings', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('add.txt');
      var siblingPath = getFixturePath('change.txt');
      var testArg = {type: 'add', path: testPath};
      var watcher = chokidar.watch(testPath, options)
        .on('all', spy)
        .on('ready', w(function() {
          fs.writeFileSync(siblingPath, Date.now());
          fs.writeFileSync(testPath, Date.now());
          waitFor([spy], function() {
            spy.should.have.always.been.calledWith('add', testArg);
            wClose(watcher);
            done();
          });
        }));
    });
    it('ignores the ".." path within a watched directory', function(done) {
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testFile = getFixturePath('add.txt');
      fs.mkdirSync(testDir);
      var watcher = chokidar.watch(testDir, options)
        .on('add', spy)
        .on('ready', w(function() {
          fs.writeFileSync(testFile, Date.now());
          w(function() {
            spy.should.not.have.been.called;
            wClose(watcher);
            done();
          }, 600)();
        }));
    });
    it('ignores the ".." path within a watched directory using the cwd option', function(done) {
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testFile = getFixturePath('add.txt');
      options.cwd = testDir;
      fs.mkdirSync(testDir);
      var watcher = chokidar.watch('**', options)
        .on('add', spy)
        .on('ready', w(function() {
          fs.writeFileSync(testFile, Date.now());
          w(function() {
            spy.should.not.have.been.called;
            wClose(watcher);
            done();
          }, 600)();
        }));
    });
  });
  if (baseopts.useFsEvents) {
    describe('consolidate', function() {
      it('consolidates watcher when number of watchers exceeds threshold', function(done) {
        // This test is to satisfy coverage of function couldConsolidate() in lib/fsevents-handler.js.
        // To test this, create a number of subdirectories beyond the consolidation threshold.
        // function couldConsolidate() is black-boxed and we cannot directly count the number of watchers.
        // Instead, we check to see if function couldConsolidate() is covered by nyc/istanbul.
        var spy = sinon.spy();
        var subdirRoot = getFixturePath('');
        var postThreshold = 11;
        var i = postThreshold;
        var subdirPath = sysPath.join(subdirRoot, 'subdir' + i);
        var watchers = [];
        fs.mkdirSync(subdirPath);
        while (i--) {
          subdirPath = sysPath.join(subdirRoot, 'subdir' + i);
          fs.mkdirSync(subdirPath);
          var watcher = chokidar.watch(subdirPath, options);
          watchers.push(watcher);
          if (i === 0) {
            var insidePath = sysPath.join(subdirRoot, 'subdir' + i, 'inside.txt'); // Should be spied.
            var outsidePath = sysPath.join(subdirRoot, 'subdir' + postThreshold, 'outside.txt'); // Should not be spied.
            var insideArg = {type: 'add', path: insidePath};
            var outsideArg = {type: 'add', path: outsidePath};
            watcher
              .on('all', spy)
              .on('ready', w(function() { // eslint-disable-line no-loop-func
                fs.writeFileSync(insidePath, Date.now());
                fs.writeFileSync(outsidePath, Date.now());
                w(function() {
                  spy.should.have.been.calledWith('add', insideArg);
                  spy.should.not.have.been.calledWith('add', outsideArg);
                  var j = postThreshold;
                  while (j--) {
                    wClose(watchers[j]);
                  }
                  done();
                }, 300)();
              }));
          }
        }
      });
    });
  }
  if (!baseopts.usePolling) { // Polling does not reliably emit `add` event on rename.
    describe('renamed directory', function() {
      it('emits `add` for a file in a renamed directory', function(done) {
        options.ignoreInitial = true;
        var spy = sinon.spy();
        var testDir = getFixturePath('subdir');
        var testPath = getFixturePath('subdir/add.txt');
        var renamedDir = getFixturePath('subdir-renamed');
        var expectedPath = sysPath.join(renamedDir, 'add.txt');
        var testArg = {type: 'add', path: expectedPath};
        fs.mkdirSync(testDir);
        fs.writeFileSync(testPath, Date.now());
        var watcher = chokidar.watch(fixturePath, options)
          .on('add', spy)
          .on('ready', w(function() {
            w(function() {
              fs.renameSync(testDir, renamedDir);
            }, 600)();
            waitFor([spy], function() {
              spy.should.have.been.calledOnce;
              spy.should.have.been.calledWith(testArg);
              wClose(watcher);
              done();
            });
          }));
      });
    });
  }
  describe('watch non-existent paths', function() {
    it('watches non-existent file and detect add', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('add.txt');
      var testArg = {type: 'add', path: testPath};
      var watcher = chokidar.watch(testPath, options)
        .on('add', spy)
        .on('ready', w(function() {
          fs.writeFileSync(testPath, Date.now());
          waitFor([spy], function() {
            spy.should.have.been.calledWith(testArg);
            wClose(watcher);
            done();
          });
        }));
    });
    it('watches non-existent dir and detect addDir/add', function(done) {
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testPath = getFixturePath('subdir/add.txt');
      var testDirArg = {type: 'addDir', path: testDir};
      var testPathArg = {type: 'add', path: testPath};
      var watcher = chokidar.watch(testDir, options)
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.not.have.been.called;
          fs.mkdirSync(testDir);
          fs.writeFileSync(testPath, 'hello');
          waitFor([spy.withArgs('add')], function() {
            spy.should.have.been.calledWith('addDir', testDirArg);
            spy.should.have.been.calledWith('add', testPathArg);
            wClose(watcher);
            done();
          });
        }));
    });
  });
  describe('watch glob patterns', function() {
    it('correctly watches and emit based on glob input', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('*a*.txt');
      var addPath = getFixturePath('add.txt');
      var changePath = getFixturePath('change.txt');
      var unlinkPath = getFixturePath('unlink.txt');
      var addArg = {type: 'add', path: changePath};
      var addArg2 = {type: 'add', path: addPath};
      var changeArg = {type: 'change', path: changePath};
      var unlinkArg = {type: 'add', path: unlinkPath};
      var watcher = chokidar.watch(testPath, options)
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.have.been.calledWith('add', addArg);
          fs.writeFileSync(addPath, Date.now());
          fs.writeFileSync(changePath, Date.now());
          waitFor([
            [spy, 3],
            spy.withArgs('add')
          ], function() {
            spy.should.have.been.calledWith('add', addArg2);
            spy.should.have.been.calledWith('change', changeArg);
            spy.should.not.have.been.calledWith('add', unlinkArg);
            spy.should.not.have.been.calledWith('addDir');
            wClose(watcher);
            done();
          });
        }));
    });
    it('respects negated glob patterns', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('*');
      var negatedPath = '!' + getFixturePath('*a*.txt');
      var unlinkPath = getFixturePath('unlink.txt');
      var addArg = {type: 'add', path: unlinkPath};
      var unlinkArg = {type: 'unlink', path: unlinkPath};
      var watcher = chokidar.watch([testPath, negatedPath], options)
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.have.been.calledOnce;
          spy.should.have.been.calledWith('add', addArg);
          fs.unlinkSync(unlinkPath);
          waitFor([
            [spy, 2],
            spy.withArgs('unlink')
          ], function() {
            spy.should.have.been.calledTwice;
            spy.should.have.been.calledWith('unlink', unlinkArg);
            wClose(watcher);
            done();
          });
        }));
    });
    it('traverses subdirs to match globstar patterns', function(done) {
      var spy = sinon.spy();
      var watchPath = getFixturePath('../../test-*/' + subdir + '/**/a*.txt');
      var parentPath = getFixturePath('subdir');
      var subPath = getFixturePath('subdir/subsub');
      var aPath = sysPath.join(parentPath, 'a.txt');
      var bPath = sysPath.join(parentPath, 'b.txt');
      var addPath = sysPath.join(parentPath, 'add.txt');
      var abPath = sysPath.join(subPath, 'ab.txt');
      var unlinkArg = {type: 'unlink', path: aPath};
      var changeArg = {type: 'change', path: abPath};
      fs.mkdirSync(parentPath);
      fs.mkdirSync(subPath);
      fs.writeFileSync(aPath, 'b');
      fs.writeFileSync(bPath, 'b');
      fs.writeFileSync(abPath, 'b');
      var watcher = chokidar.watch(watchPath, options)
        .on('all', spy)
        .on('ready', w(function() {
          fs.writeFileSync(addPath, Date.now());
          fs.writeFileSync(abPath, Date.now());
          fs.unlinkSync(aPath);
          fs.unlinkSync(bPath);
          waitFor([
            [spy.withArgs('add'), 3],
            spy.withArgs('unlink'),
            spy.withArgs('change')
          ], function() {
            spy.withArgs('add').should.have.been.calledThrice;
            spy.should.have.been.calledWith('unlink', unlinkArg);
            spy.should.have.been.calledWith('change', changeArg);
            spy.withArgs('unlink').should.have.been.calledOnce;
            spy.withArgs('change').should.have.been.calledOnce;
            wClose(watcher);
            done();
          });
        }));
    });
    it('resolves relative paths with glob patterns', function(done) {
      var spy = sinon.spy();
      var testPath = 'test-*/' + subdir + '/*a*.txt';
      // getFixturePath() returns absolute paths, so use sysPath.join() instead
      var addPath = sysPath.join('test-fixtures', subdir.toString(), 'add.txt');
      var changePath = sysPath.join('test-fixtures', subdir.toString(), 'change.txt');
      var unlinkPath = sysPath.join('test-fixtures', subdir.toString(), 'unlink.txt');
      var addArg = {type: 'add', path: changePath};
      var addArg2 = {type: 'add', path: addPath};
      var changeArg = {type: 'change', path: changePath};
      var unlinkArg = {type: 'add', path: unlinkPath};
      var watcher = chokidar.watch(testPath, options)
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.have.been.calledWith('add', addArg);
          fs.writeFileSync(addPath, Date.now());
          fs.writeFileSync(changePath, Date.now());
          w(function() {
            spy.should.have.been.calledWith('add', addArg2);
            spy.should.have.been.calledWith('change', changeArg);
            spy.should.not.have.been.calledWith('add', unlinkArg);
            spy.should.not.have.been.calledWith('addDir');
            if (!osXFsWatch) spy.should.have.been.calledThrice;
            wClose(watcher);
            done();
          }, 300)();
        }));
    });
    it('correctly handles conflicting glob patterns', function(done) {
      var spy = sinon.spy();
      var changePath = getFixturePath('change.txt');
      var unlinkPath = getFixturePath('unlink.txt');
      var addPath = getFixturePath('add.txt');
      var watchPaths = [getFixturePath('change*'), getFixturePath('unlink*')];
      var addArg = {type: 'add', path: changePath};
      var addArg2 = {type: 'add', path: unlinkPath};
      var addArg3 = {type: 'add', path: addPath};
      var changeArg = {type: 'change', path: changePath};
      var unlinkArg = {type: 'unlink', path: unlinkPath};
      var watcher = chokidar.watch(watchPaths, options)
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.have.been.calledWith('add', addArg);
          spy.should.have.been.calledWith('add', addArg2);
          spy.should.have.been.calledTwice;
          fs.writeFileSync(addPath, Date.now());
          fs.writeFileSync(changePath, Date.now());
          fs.unlinkSync(unlinkPath);
          w(function() {
            spy.should.have.been.calledWith('change', changeArg);
            spy.should.have.been.calledWith('unlink', unlinkArg);
            spy.should.not.have.been.calledWith('add', addArg3);
            if (!osXFsWatch) spy.callCount.should.equal(4);
            wClose(watcher);
            done();
          }, 300)();
        }));
    });
    it('correctly handles intersecting glob patterns', function(done) {
      var spy = sinon.spy();
      var changePath = getFixturePath('change.txt');
      var watchPaths = [getFixturePath('cha*'), getFixturePath('*nge.*')];
      var addArg = {type: 'add', path: changePath};
      var changeArg = {type: 'change', path: changePath};
      var watcher = chokidar.watch(watchPaths, options)
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.have.been.calledWith('add', addArg);
          spy.should.have.been.calledOnce;
          fs.writeFileSync(changePath, Date.now());
          waitFor([[spy, 2]], function() {
            spy.should.have.been.calledWith('change', changeArg);
            spy.should.have.been.calledTwice;
            wClose(watcher);
            done();
          });
        }));
    });
    it('does not confuse glob-like filenames with globs', function(done) {
      var spy = sinon.spy();
      var filePath = getFixturePath('nota[glob].txt');
      var addArg = {type: 'add', path: filePath};
      var changeArg = {type: 'change', path: filePath};
      fs.writeFileSync(filePath, 'b');
      var watcher = stdWatcher()
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.have.been.calledWith('add', addArg);
          fs.writeFileSync(filePath, Date.now());
          w(function() {
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          }, 300)();
        }));
    });
    it('treats glob-like directory names as literal directory names when globbing is disabled', function(done) {
      options.disableGlobbing = true;
      var spy = sinon.spy();
      var filePath = getFixturePath('nota[glob]/a.txt');
      var watchPath = getFixturePath('nota[glob]');
      var matchingDir = getFixturePath('notag');
      var matchingFile = getFixturePath('notag/b.txt');
      var matchingFile2 = getFixturePath('notal');
      var addArg = {type: 'add', path: filePath};
      var addArg2 = {type: 'add', path: matchingFile};
      var addArg3 = {type: 'add', path: matchingFile2};
      var addDirArg = {type: 'add', path: matchingDir};
      var changeArg = {type: 'change', path: filePath};
      fs.mkdirSync(watchPath);
      fs.writeFileSync(filePath, 'b');
      fs.mkdirSync(matchingDir);
      fs.writeFileSync(matchingFile, 'c');
      fs.writeFileSync(matchingFile2, 'd');
      var watcher = chokidar.watch(watchPath, options)
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.have.been.calledWith('add', addArg);
          spy.should.not.have.been.calledWith('add', addArg2);
          spy.should.not.have.been.calledWith('add', addArg3);
          spy.should.not.have.been.calledWith('addDir', addDirArg);
          fs.writeFileSync(filePath, Date.now());
          w(function() {
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          }, 300)();
        }));
    });
    it('treats glob-like filenames as literal filenames when globbing is disabled', function(done) {
      options.disableGlobbing = true;
      var spy = sinon.spy();
      var filePath = getFixturePath('nota[glob]');
      var watchPath = getFixturePath('nota[glob]');
      var matchingDir = getFixturePath('notag');
      var matchingFile = getFixturePath('notag/a.txt');
      var matchingFile2 = getFixturePath('notal');
      var addArg = {type: 'add', path: filePath};
      var addArg2 = {type: 'add', path: matchingFile};
      var addArg3 = {type: 'add', path: matchingFile2};
      var addDirArg = {type: 'add', path: matchingDir};
      var changeArg = {type: 'change', path: filePath};
      fs.writeFileSync(filePath, 'b');
      fs.mkdirSync(matchingDir);
      fs.writeFileSync(matchingFile, 'c');
      fs.writeFileSync(matchingFile2, 'd');
      var watcher = chokidar.watch(watchPath, options)
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.have.been.calledWith('add', addArg);
          spy.should.not.have.been.calledWith('add', addArg2);
          spy.should.not.have.been.calledWith('add', addArg3);
          spy.should.not.have.been.calledWith('addDir', addDirArg);
          fs.writeFileSync(filePath, Date.now());
          w(function() {
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          }, 300)();
        }));
    });
    it('does not prematurely filter dirs against complex globstar patterns', function(done) {
      var spy = sinon.spy();
      var deepFile = getFixturePath('subdir/subsub/subsubsub/a.txt');
      var watchPath = getFixturePath('../../test-*/' + subdir + '/**/subsubsub/*.txt');
      var addArg = {type: 'add', path: deepFile};
      var changeArg = {type: 'change', path: deepFile};
      fs.mkdirSync(getFixturePath('subdir'));
      fs.mkdirSync(getFixturePath('subdir/subsub'));
      fs.mkdirSync(getFixturePath('subdir/subsub/subsubsub'));
      fs.writeFileSync(deepFile, 'b');
      var watcher = chokidar.watch(watchPath, options)
        .on('all', spy)
        .on('ready', w(function() {
          fs.writeFileSync(deepFile, Date.now());
          waitFor([[spy, 2]], function() {
            spy.should.have.been.calledWith('add', addArg);
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        }));
    });
    it('emits matching dir events', function(done) {
      var spy = sinon.spy();
      // test with and without globstar matches
      var watchPaths = [getFixturePath('*'), getFixturePath('subdir/subsub/**/*')];
      var parentPath = getFixturePath('subdir');
      var subPath = sysPath.join(parentPath, 'subsub');
      var deepDir = sysPath.join(subPath, 'subsubsub');
      var deepFile = sysPath.join(deepDir, 'a.txt');
      var addDirArg = {type: 'addDir', path: parentPath};
      var addDirArg2 = {type: 'addDir', path: deepDir};
      var unlinkDirArg = {type: 'unlinkDir', path: deepDir};
      fs.mkdirSync(parentPath);
      fs.mkdirSync(subPath);
      var watcher = chokidar.watch(watchPaths, options)
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.have.been.calledWith('addDir', addDirArg);
          spy.withArgs('addDir').should.have.been.calledOnce;
          fs.mkdirSync(deepDir);
          fs.writeFileSync(deepFile, Date.now());
          w(function() {
            if (win32Polling) return done();
            spy.should.have.been.calledWith('addDir', addDirArg2);
            fs.unlinkSync(deepFile);
            fs.rmdirSync(deepDir);
            waitFor([spy.withArgs('unlinkDir')], function() {
              spy.should.have.been.calledWith('unlinkDir', unlinkDirArg);
              wClose(watcher);
              done();
            });
          }, 300)();
        }));
    });
  });
  describe('watch symlinks', function() {
    if (platform === 'win32') return;
    var linkedDir;
    beforeEach(function(done) {
      linkedDir = sysPath.resolve(fixturePath, '..', subdir + '-link');
      fs.symlinkSync(fixturePath, linkedDir);
      fs.mkdirSync(getFixturePath('subdir'));
      fs.writeFileSync(getFixturePath('subdir/add.txt'), 'b');
      done();
    });
    afterEach(function(done) {
      fs.unlinkSync(linkedDir);
      done();
    });
    it('watches symlinked dirs', function(done) {
      var dirSpy = sinon.spy();
      var addSpy = sinon.spy();
      var watcher = chokidar.watch(linkedDir, options)
        .on('addDir', dirSpy)
        .on('add', addSpy)
        .on('ready', function() {
          dirSpy.should.have.been.calledWith({type: 'addDir', path: linkedDir});
          addSpy.should.have.been.calledWith({type: 'add', path: sysPath.join(linkedDir, 'change.txt')});
          addSpy.should.have.been.calledWith({type: 'add', path: sysPath.join(linkedDir, 'unlink.txt')});
          wClose(watcher);
          done();
        });
    });
    it('watches symlinked files', function(done) {
      var spy = sinon.spy();
      var changePath = getFixturePath('change.txt');
      var linkPath = getFixturePath('link.txt');
      var addArg = {type: 'add', path: linkPath};
      var changeArg = {type: 'change', path: linkPath};
      fs.symlinkSync(changePath, linkPath);
      var watcher = chokidar.watch(linkPath, options)
        .on('all', spy)
        .on('ready', w(function() {
          fs.writeFileSync(changePath, Date.now());
          waitFor([spy.withArgs('change')], function() {
            spy.should.have.been.calledWith('add', addArg);
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        }));
    });
    it('follows symlinked files within a normal dir', function(done) {
      var spy = sinon.spy();
      var changePath = getFixturePath('change.txt');
      var testDir = getFixturePath('subdir');
      var linkPath = sysPath.join(testDir, 'link.txt');
      var addArg = {type: 'add', path: linkPath};
      var changeArg = {type: 'change', path: linkPath};
      fs.symlinkSync(changePath, linkPath);
      var watcher = chokidar.watch(getFixturePath('subdir'), options)
        .on('all', spy)
        .on('ready', w(function() {
          fs.writeFileSync(changePath, Date.now());
          w(function() {
            spy.should.have.been.calledWith('add', addArg);
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          }, 300)();
        }));
    });
    it('watches paths with a symlinked parent', function(done) {
      var spy = sinon.spy();
      var testDir = sysPath.join(linkedDir, 'subdir');
      var testFile = sysPath.join(testDir, 'add.txt');
      var addDirArg = {type: 'addDir', path: testDir};
      var addArg = {type: 'add', path: testFile};
      var changeArg = {type: 'change', path: testFile};
      var watcher = chokidar.watch(testDir, options)
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.have.been.calledWith('addDir', addDirArg);
          spy.should.have.been.calledWith('add', addArg);
          fs.writeFileSync(getFixturePath('subdir/add.txt'), Date.now());
          waitFor([spy.withArgs('change')], function() {
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        }));
    });
    it('does not recurse indefinitely on circular symlinks', function(done) {
      fs.symlinkSync(fixturePath, getFixturePath('subdir/circular'));
      var watcher = stdWatcher()
        .on('ready', function() {
          wClose(watcher);
          done();
        });
    });
    it('recognizes changes following symlinked dirs', function(done) {
      var spy = sinon.spy();
      var watcher = chokidar.watch(linkedDir, options)
        .on('change', spy)
        .on('ready', w(function() {
          var linkedFilePath = sysPath.join(linkedDir, 'change.txt');
          var testArg = {type: 'change', path: linkedFilePath};
          fs.writeFileSync(getFixturePath('change.txt'), Date.now());
          w(function() {
            spy.should.have.been.calledWith(testArg);
            wClose(watcher);
            done();
          }, 300)();
        }));
    });
    it('follows newly created symlinks', function(done) {
      options.ignoreInitial = true;
      var spy = sinon.spy();
      var testDir = getFixturePath('link');
      var testPath = getFixturePath('link/add.txt');
      var testDirArg = {type: 'addDir', path: testDir};
      var testPathArg = {type: 'add', path: testPath};
      var watcher = stdWatcher()
        .on('all', spy)
        .on('ready', w(function() {
          fs.symlinkSync(getFixturePath('subdir'), testDir);
          w(function() {
            spy.should.have.been.calledWith('addDir', testDirArg);
            spy.should.have.been.calledWith('add', testPathArg);
            wClose(watcher);
            done();
          }, 300)();
        }));
    });
    it('watches symlinks as files when followSymlinks:false', function(done) {
      options.followSymlinks = false;
      var spy = sinon.spy();
      var watcher = chokidar.watch(linkedDir, options)
        .on('all', spy)
        .on('ready', function() {
          spy.should.not.have.been.calledWith('addDir');
          spy.should.have.been.calledWith('add', {type: 'add', path: linkedDir});
          spy.should.have.been.calledOnce;
          wClose(watcher);
          done();
        });
    });
    it('watches symlinks within a watched dir as files when followSymlinks:false', function(done) {
      options.followSymlinks = false;
      var spy = sinon.spy();
      var linkPath = getFixturePath('link');
      var testPath = getFixturePath('subdir/add.txt');
      var addArg = {type: 'add', path: linkPath};
      var addArg2 = {type: 'add', path: testPath};
      var addDirArg = {type: 'addDir', path: linkPath};
      var changeArg = {type: 'change', path: linkPath};
      fs.symlinkSync(getFixturePath('subdir'), linkPath);
      var watcher = stdWatcher()
        .on('all', spy)
        .on('ready', w(function() {
          fs.writeFileSync(testPath, Date.now());
          fs.unlinkSync(linkPath);
          fs.symlinkSync(testPath, linkPath);
          w(function() {
            spy.should.have.been.calledWith('add', addArg);
            spy.should.have.been.calledWith('add', addArg2);
            spy.should.have.been.calledWith('change', changeArg);
            spy.should.not.have.been.calledWith('addDir', addDirArg);
            wClose(watcher);
            done();
          }, 1500)();
        }, options.usePolling ? 1000 : null));
    });
    it('does not reuse watcher when following a symlink to elsewhere', function(done) {
      var spy = sinon.spy();
      var linkedPath = getFixturePath('outside');
      var linkedFilePath = sysPath.join(linkedPath, 'text.txt');
      var linkPath = getFixturePath('subdir/subsub');
      fs.mkdirSync(linkedPath);
      fs.writeFileSync(linkedFilePath, 'b');
      fs.symlinkSync(linkedPath, linkPath);
      var watcher2 = chokidar.watch(getFixturePath('subdir'), options)
        .on('ready', function() {
          var watchedPath = getFixturePath('subdir/subsub/text.txt');
          var testArg = {type: 'change', path: watchedPath};
          var watcher = chokidar.watch(watchedPath, options)
            .on('all', spy)
            .on('ready', w(function() {
              fs.writeFileSync(linkedFilePath, Date.now());
              waitFor([spy.withArgs('change')], function() {
                spy.should.have.been.calledWith('change', testArg);
                wClose(watcher);
                wClose(watcher2);
                done();
              });
            }));
        });
    });
    it('properly matches glob patterns that include a symlinked dir', function(done) {
      var dirSpy = sinon.spy();
      var addSpy = sinon.spy();
      // test with relative path to ensure proper resolution
      var watchDir = sysPath.relative(process.cwd(), linkedDir);
      var changePath = sysPath.join(watchDir, 'change.txt');
      var subdirPath = sysPath.join(watchDir, 'subdir');
      var addPath = sysPath.join(watchDir, 'add.txt');
      var changeArg = {type: 'add', path: changePath};
      var subdirArg = {type: 'addDir', path: subdirPath};
      var addArg = {type: 'add', path: addPath};
      var watcher = chokidar.watch(sysPath.join(watchDir, '**/*'), options)
        .on('addDir', dirSpy)
        .on('add', addSpy)
        .on('ready', w(function() {
          // only the children are matched by the glob pattern, not the link itself
          addSpy.should.have.been.calledWith(changeArg);
          addSpy.should.have.been.calledThrice; // also unlink.txt & subdir/add.txt
          dirSpy.should.have.been.calledWith(subdirArg);
          fs.writeFileSync(addPath);
          waitFor([[addSpy, 4]], function() {
            addSpy.should.have.been.calledWith(addArg);
            wClose(watcher);
            done();
          });
        }));
    });
  });
  describe('watch arrays of paths/globs', function() {
    it('watches all paths in an array', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('change.txt');
      var testDir = getFixturePath('subdir');
      var unlinkPath = getFixturePath('unlink.txt');
      var addArg = {type: 'add', path: testPath};
      var addDirArg = {type: 'addDir', path: testDir};
      var changeArg = {type: 'change', path: testPath};
      var unlinkArg = {type: 'add', path: unlinkPath};
      fs.mkdirSync(testDir);
      var watcher = chokidar.watch([testDir, testPath], options)
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.have.been.calledWith('add', addArg);
          spy.should.have.been.calledWith('addDir', addDirArg);
          spy.should.not.have.been.calledWith('add', unlinkArg);
          fs.writeFileSync(testPath, Date.now());
          waitFor([spy.withArgs('change')], function() {
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        }));
    });
    it('accommodates nested arrays in input', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('change.txt');
      var testDir = getFixturePath('subdir');
      var unlinkPath = getFixturePath('unlink.txt');
      var addArg = {type: 'add', path: testPath};
      var addDirArg = {type: 'addDir', path: testDir};
      var changeArg = {type: 'change', path: testPath};
      var unlinkArg = {type: 'add', path: unlinkPath};
      fs.mkdirSync(testDir);
      var watcher = chokidar.watch([[testDir], [testPath]], options)
        .on('all', spy)
        .on('ready', w(function() {
          spy.should.have.been.calledWith('add', addArg);
          spy.should.have.been.calledWith('addDir', addDirArg);
          spy.should.not.have.been.calledWith('add', unlinkArg);
          fs.writeFileSync(testPath, Date.now());
          waitFor([spy.withArgs('change')], function() {
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        }));
    });
    it('throws if provided any non-string paths', function() {
      expect(chokidar.watch.bind(null, [[fixturePath], /notastring/]))
        .to.throw(TypeError, /non-string/i);
    });
  });
  describe('watch options', function() {
    describe('ignoreInitial', function() {
      describe('false', function() {
        beforeEach(function() { options.ignoreInitial = false; });
        it('emits `add` events for preexisting files', function(done) {
          var spy = sinon.spy();
          var watcher = chokidar.watch(fixturePath, options)
            .on('add', spy)
            .on('ready', function() {
              spy.should.have.been.calledTwice;
              wClose(watcher);
              done();
            });
        });
        it('emits `addDir` event for watched dir', function(done) {
          var spy = sinon.spy();
          var watcher = chokidar.watch(fixturePath, options)
            .on('addDir', spy)
            .on('ready', function() {
              spy.should.have.been.calledOnce;
              spy.should.have.been.calledWith({type: 'addDir', path: fixturePath});
              wClose(watcher);
              done();
            });
        });
        it('emits `addDir` events for preexisting dirs', function(done) {
          var spy = sinon.spy();
          var parentPath = getFixturePath('subdir');
          var subPath = getFixturePath('subdir/subsub');
          var parentArg = {type: 'addDir', path: parentPath};
          var subArg = {type: 'addDir', path: subPath};
          fs.mkdirSync(parentPath);
          fs.mkdirSync(subPath);
          var watcher = chokidar.watch(fixturePath, options)
            .on('addDir', spy)
            .on('ready', function() {
              spy.should.have.been.calledWith({type: 'addDir', path: fixturePath});
              spy.should.have.been.calledWith(parentArg);
              spy.should.have.been.calledWith(subArg);
              spy.should.have.been.calledThrice;
              wClose(watcher);
              done();
            });
        });
      });
      describe('true', function() {
        beforeEach(function() { options.ignoreInitial = true; });
        it('ignores inital add events', function(done) {
          var spy = sinon.spy();
          var watcher = stdWatcher()
            .on('add', spy)
            .on('ready', function() {
              spy.should.not.have.been.called;
              wClose(watcher);
              done();
            });
        });
        it('ignores add events on a subsequent .add()', function(done) {
          var spy = sinon.spy();
          var watcher = chokidar.watch(getFixturePath('subdir'), options)
            .on('add', spy)
            .on('ready', function() {
              watcher.add(fixturePath);
              w(function() {
                spy.should.not.have.been.called;
                wClose(watcher);
                done();
              }, 600)();
            });
        });
        it('notices when a file appears in an empty directory', function(done) {
          var spy = sinon.spy();
          var testDir = getFixturePath('subdir');
          var testPath = getFixturePath('subdir/add.txt');
          var testArg = {type: 'add', path: testPath};
          var watcher = stdWatcher()
            .on('add', spy)
            .on('ready', w(function() {
              spy.should.not.have.been.called;
              fs.mkdirSync(testDir);
              fs.writeFileSync(testPath, Date.now());
              waitFor([spy], function() {
                spy.should.have.been.calledOnce;
                spy.should.have.been.calledWith(testArg);
                wClose(watcher);
                done();
              });
            }));
        });
        it('emits a change on a preexisting file as a change', function(done) {
          var spy = sinon.spy();
          var testPath = getFixturePath('change.txt');
          var testArg = {type: 'change', path: testPath};
          var watcher = stdWatcher()
            .on('all', spy)
            .on('ready', w(function() {
              spy.should.not.have.been.called;
              fs.writeFileSync(testPath, Date.now());
              w(function() {
                spy.should.have.been.calledWith('change', testArg);
                spy.should.not.have.been.calledWith('add');
                wClose(watcher);
                done();
              }, 300)();
            }));
        });
      });
    });
    describe('ignored', function() {
      it('checks ignore after statting', function(done) {
        var testDir;
        options.ignored = function(path, stats) {
          if (path === testDir || !stats) return false;
          return stats.isDirectory();
        };
        var spy = sinon.spy();
        testDir = getFixturePath('subdir');
        var addPath = sysPath.join(testDir, 'add.txt');
        var addArg = {type: 'add', path: addPath};
        fs.mkdirSync(testDir);
        fs.writeFileSync(addPath, '');
        fs.mkdirSync(sysPath.join(testDir, 'subsub'));
        fs.writeFileSync(sysPath.join(testDir, 'subsub', 'ab.txt'), '');
        var watcher = chokidar.watch(testDir, options)
          .on('add', spy)
          .on('ready', function() {
            if (platform !== 'win32') {
              spy.should.have.been.calledOnce;
              spy.should.have.been.calledWith(addArg);
            }
            wClose(watcher);
            done();
          });
      });
      it('does not choke on an ignored watch path', function(done) {
        options.ignored = function() { return true; };
        var watcher = stdWatcher().on('ready', function() {
          wClose(watcher);
          done();
        });
      });
      it('ignores the contents of ignored dirs', function(done) {
        var spy = sinon.spy();
        var testDir = getFixturePath('subdir');
        var testFile = sysPath.join(testDir, 'add.txt');
        var ignoredArg = {type: 'addDir', path: testDir};
        var ignoredArg2 = {type: 'add', path: testFile};
        var ignoredArg3 = {type: 'change', path: testFile};
        options.ignored = testDir;
        fs.mkdirSync(testDir);
        fs.writeFileSync(testFile, 'b');
        var watcher = chokidar.watch(fixturePath, options)
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(testFile, Date.now());
            w(function() {
              spy.should.not.have.been.calledWith('addDir', ignoredArg);
              spy.should.not.have.been.calledWith('add', ignoredArg2);
              spy.should.not.have.been.calledWith('change', ignoredArg3);
              wClose(watcher);
              done();
            })();
          }));
      });
      it('allows regex ignores', function(done) {
        options.cwd = fixturePath;
        options.ignored = /add/;
        var spy = sinon.spy();
        var addPath = getFixturePath('add.txt');
        var changePath = getFixturePath('change.txt');
        var addArg = {type: 'add', path: changePath};
        var changeArg = {type: 'change', path: changePath};
        var ignoredArg = {type: 'add', path: addPath};
        var ignoredArg2 = {type: 'change', path: addPath};
        fs.writeFileSync(addPath, 'b');
        var watcher = chokidar.watch(fixturePath, options)
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(addPath, Date.now());
            fs.writeFileSync(changePath, Date.now());
            w(function() {
              spy.should.have.been.calledWith('add', addArg);
              spy.should.have.been.calledWith('change', changeArg);
              spy.should.not.have.been.calledWith('add', ignoredArg);
              spy.should.not.have.been.calledWith('change', ignoredArg2);
              wClose(watcher);
              done();
            }, 300)();
          }));
      });
      it('allows regex fn ignores', function(done) {
        options.ignored = function(path) {
          return /sub/.test(path);
        };
        var spy = sinon.spy();
        var subdirPath = getFixturePath('subdir');
        var changePath = getFixturePath('change.txt');
        var changeArg = {type: 'change', path: changePath};
        var ignoredArg = {type: 'addDir', path: subdirPath};
        fs.mkdirSync(subdirPath);
        var watcher = chokidar.watch(fixturePath, options)
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(changePath, Date.now());
            w(function() {
              spy.should.have.been.calledWith('change', changeArg);
              spy.should.not.have.been.calledWith('addDir', ignoredArg);
              wClose(watcher);
              done();
            }, 300)();
          }));
      });
    });
    describe('depth', function() {
      beforeEach(function(done) {
        var i = 0;
        var r = function() { i++ && w(done, options.useFsEvents && 100)(); };
        fs.mkdirSync(getFixturePath('subdir'));
        fs.writeFile(getFixturePath('subdir/add.txt'), 'b', r);
        fs.mkdirSync(getFixturePath('subdir/subsub'));
        fs.writeFile(getFixturePath('subdir/subsub/ab.txt'), 'b', r);
      });
      it('does not recurse if depth is 0', function(done) {
        options.depth = 0;
        var spy = sinon.spy();
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(getFixturePath('subdir/add.txt'), Date.now());
            waitFor([[spy, 4]], function() {
              spy.should.have.been.calledWith('addDir', {type: 'addDir', path: fixturePath});
              spy.should.have.been.calledWith('addDir', {type: 'addDir', path: getFixturePath('subdir')});
              spy.should.have.been.calledWith('add', {type: 'add', path: getFixturePath('change.txt')});
              spy.should.have.been.calledWith('add', {type: 'add', path: getFixturePath('unlink.txt')});
              spy.should.not.have.been.calledWith('change');
              if (!osXFsWatch) spy.callCount.should.equal(4);
              wClose(watcher);
              done();
            });
          }));
      });
      it('recurses to specified depth', function(done) {
        options.depth = 1;
        var spy = sinon.spy();
        var addDirPath = getFixturePath('subdir/subsub');
        var addPath = getFixturePath('subdir/add.txt');
        var changePath = getFixturePath('change.txt');
        var ignoredPath = getFixturePath('subdir/subsub/ab.txt');
        var addDirArg = {type: 'addDir', path: addDirPath};
        var addArg = {type: 'change', path: addPath};
        var changeArg = {type: 'change', path: changePath};
        var ignoredArg = {type: 'add', path: ignoredPath};
        var ignoredArg2 = {type: 'change', path: ignoredPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(changePath, Date.now());
            fs.writeFileSync(addPath, Date.now());
            fs.writeFileSync(ignoredPath, Date.now());
            w(function() {
              spy.should.have.been.calledWith('addDir', addDirArg);
              spy.should.have.been.calledWith('change', changeArg);
              spy.should.have.been.calledWith('change', addArg);
              spy.should.not.have.been.calledWith('add', ignoredArg);
              spy.should.not.have.been.calledWith('change', ignoredArg2);
              if (!osXFsWatch) spy.callCount.should.equal(8);
              wClose(watcher);
              done();
            }, 300)();
          }));
      });
      it('respects depth setting when following symlinks', function(done) {
        if (platform === 'win32') return done(); // skip on windows
        options.depth = 1;
        var spy = sinon.spy();
        var subPath = getFixturePath('subdir');
        var addDirPath = getFixturePath('link');
        var addDirPath2 = sysPath.join(addDirPath, 'subsub');
        var addPath = sysPath.join(addDirPath, 'add.txt');
        var ignoredPath = sysPath.join(addDirPath2, 'ab.txt');
        var addDirArg = {type: 'addDir', path: addDirPath};
        var addDirArg2 = {type: 'addDir', path: addDirPath2};
        var addArg = {type: 'add', path: addPath};
        var ignoredArg = {type: 'change', path: ignoredPath};
        fs.symlinkSync(subPath, addDirPath);
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            spy.should.have.been.calledWith('addDir', addDirArg);
            spy.should.have.been.calledWith('addDir', addDirArg2);
            spy.should.have.been.calledWith('add', addArg);
            spy.should.not.have.been.calledWith('add', ignoredArg);
            wClose(watcher);
            done();
          });
      });
      it('respects depth setting when following a new symlink', function(done) {
        if (platform === 'win32') return done(); // skip on windows
        options.depth = 1;
        options.ignoreInitial = true;
        var spy = sinon.spy();
        var linkPath = getFixturePath('link');
        var dirPath = sysPath.join(linkPath, 'subsub');
        var addPath = sysPath.join(linkPath, 'add.txt');
        var addDirArg = {type: 'addDir', path: linkPath};
        var addDirArg2 = {type: 'addDir', path: dirPath};
        var addArg = {type: 'add', path: addPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.symlinkSync(getFixturePath('subdir'), linkPath);
            w(function() {
              spy.should.have.been.calledWith('addDir', addDirArg);
              spy.should.have.been.calledWith('addDir', addDirArg2);
              spy.should.have.been.calledWith('add', addArg);
              if (!osXFsWatch) spy.should.have.been.calledThrice;
              wClose(watcher);
              done();
            }, 300)();
          }));
      });
      it('correctly handles dir events when depth is 0', function(done) {
        options.depth = 0;
        var spy = sinon.spy();
        var addSpy = spy.withArgs('addDir');
        var unlinkSpy = spy.withArgs('unlinkDir');
        var subdirPath = getFixturePath('subdir');
        var subdirPath2 = getFixturePath('subdir2');
        var addDirArg = {type: 'addDir', path: fixturePath};
        var addDirArg2 = {type: 'addDir', path: subdirPath};
        var unlinkDirArg = {type: 'unlinkDir', path: subdirPath2};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() { // Not calling w() helps this pass in Linux.
            spy.should.have.been.calledWith('addDir', addDirArg);
            spy.should.have.been.calledWith('addDir', addDirArg2);
            fs.mkdirSync(subdirPath2);
            waitFor([[addSpy, 3]], function() {
              addSpy.should.have.been.calledThrice;
              fs.rmdirSync(subdirPath2);
              waitFor([unlinkSpy], function() {
                unlinkSpy.should.have.been.calledWith('unlinkDir', unlinkDirArg);
                unlinkSpy.should.have.been.calledOnce;
                wClose(watcher);
                done();
              });
            });
          });
      });
    });
    describe('atomic', function() {
      beforeEach(function() {
        options.atomic = true;
        options.ignoreTmpFiles = false;
        options.ignoreInitial = true;
      });
      it('ignores Vim/Emacs/Sublime swapfiles', function(done) {
        var spy = sinon.spy();
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(getFixturePath('.change.txt.swp'), 'a'); // vim
            fs.writeFileSync(getFixturePath('add.txt~'), 'a'); // emacs
            fs.writeFileSync(getFixturePath('.subl5f4.tmp'), 'a'); // sublime
            w(function() {
              fs.writeFileSync(getFixturePath('.change.txt.swp'), 'c');
              fs.writeFileSync(getFixturePath('add.txt~'), 'c');
              fs.writeFileSync(getFixturePath('.subl5f4.tmp'), 'c');
              w(function() {
                fs.unlinkSync(getFixturePath('.change.txt.swp'));
                fs.unlinkSync(getFixturePath('add.txt~'));
                fs.unlinkSync(getFixturePath('.subl5f4.tmp'));
                w(function() {
                  spy.should.not.have.been.called;
                  wClose(watcher);
                  done();
                }, 300)();
              }, 300)();
            }, 300)();
          }));
      });
    });
    describe('ignoreTmpFiles', function() {
      beforeEach(function() {
        options.atomic = false;
        options.ignoreTmpFiles = true;
        options.ignoreInitial = true;
      });
      it('ignores Vim/Emacs/Sublime swapfiles', function(done) {
        var spy = sinon.spy();
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(getFixturePath('.change.txt.swp'), 'a'); // vim
            fs.writeFileSync(getFixturePath('add.txt~'), 'a'); // emacs
            fs.writeFileSync(getFixturePath('.subl5f4.tmp'), 'a'); // sublime
            w(function() {
              fs.writeFileSync(getFixturePath('.change.txt.swp'), 'c');
              fs.writeFileSync(getFixturePath('add.txt~'), 'c');
              fs.writeFileSync(getFixturePath('.subl5f4.tmp'), 'c');
              w(function() {
                fs.unlinkSync(getFixturePath('.change.txt.swp'));
                fs.unlinkSync(getFixturePath('add.txt~'));
                fs.unlinkSync(getFixturePath('.subl5f4.tmp'));
                w(function() {
                  spy.should.not.have.been.called;
                  wClose(watcher);
                  done();
                })();
              })();
            })();
          }));
      });
    });
    describe('cwd', function() {
      it('emits relative paths based on cwd', function(done) {
        options.cwd = fixturePath;
        var spy = sinon.spy();
        var changePath = getFixturePath('change.txt');
        var unlinkPath = getFixturePath('unlink.txt');
        var addArg = {type: 'add', path: changePath};
        var addArg2 = {type: 'add', path: unlinkPath};
        var changeArg = {type: 'change', path: changePath};
        var unlinkArg = {type: 'unlink', path: unlinkPath};
        var watcher = chokidar.watch('**', options)
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(changePath, Date.now());
            fs.unlinkSync(unlinkPath);
            w(function() {
              spy.should.have.been.calledWith('add', addArg);
              spy.should.have.been.calledWith('add', addArg2);
              spy.should.have.been.calledWith('change', changeArg);
              if (!osXFsWatch && os === 'darwin') spy.should.have.been.calledWith('unlink', unlinkArg);
              wClose(watcher);
              done();
            }, 600)();
          }));
      });
      it('allows separate watchers to have different cwds', function(done) {
        options.cwd = getFixturePath('subdir');
        var options2 = {};
        Object.keys(options).forEach(function(key) { options2[key] = options[key]; });
        options2.cwd = getFixturePath('subdir2');
        var spy = sinon.spy();
        var spy2 = sinon.spy();
        var testPath = sysPath.join(options.cwd, 'add.txt');
        var testPath2 = sysPath.join(options2.cwd, 'add.txt');
        var testArg = {type: 'add', path: testPath};
        var testArg2 = {type: 'add', path: testPath2};
        fs.mkdirSync(options.cwd);
        fs.mkdirSync(options2.cwd);
        var watcher = chokidar.watch('**', options)
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(testPath, Date.now());
            var watcher2 = chokidar.watch('**', options2)
              .on('all', spy2)
              .on('ready', w(function() {
                fs.writeFileSync(testPath2, Date.now());
                w(function() {
                  spy.should.have.been.calledWith('add', testArg);
                  spy2.should.have.been.calledWith('add', testArg2);
                  wClose(watcher2);
                  wClose(watcher);
                  done();
                }, 100)();
              }));
          }));
      });
      it('ignores files even with cwd', function(done) {
        options.cwd = fixturePath;
        options.ignored = 'ignored-option.txt';
        var spy = sinon.spy();
        var files = [
          '*.txt',
          '!ignored.txt'
        ];
        var changePath = getFixturePath('change.txt');
        var ignoredPath = getFixturePath('ignored.txt');
        var ignoredPath2 = getFixturePath('ignored-option.txt');
        var addArg = {type: 'add', path: changePath};
        var changeArg = {type: 'change', path: changePath};
        var ignoredArg = {type: 'add', path: ignoredPath};
        var ignoredArg2 = {type: 'add', path: ignoredPath2};
        var ignoredArg3 = {type: 'change', path: ignoredPath};
        var ignoredArg4 = {type: 'change', path: ignoredPath2};
        var ignoredArg5 = {type: 'unlink', path: ignoredPath};
        var ignoredArg6 = {type: 'unlink', path: ignoredPath2};
        fs.writeFileSync(changePath, 'hello');
        fs.writeFileSync(ignoredPath, 'ignored');
        fs.writeFileSync(ignoredPath2, 'ignored option');
        var watcher = chokidar.watch(files, options)
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(ignoredPath, Date.now());
            fs.writeFileSync(ignoredPath2, Date.now());
            fs.unlinkSync(ignoredPath);
            fs.unlinkSync(ignoredPath2);
            fs.writeFileSync(changePath, 'change');
            w(function() {
              spy.should.have.been.calledWith('add', addArg);
              spy.should.have.been.calledWith('change', changeArg);
              spy.should.not.have.been.calledWith('add', ignoredArg);
              spy.should.not.have.been.calledWith('add', ignoredArg2);
              spy.should.not.have.been.calledWith('change', ignoredArg3);
              spy.should.not.have.been.calledWith('change', ignoredArg4);
              spy.should.not.have.been.calledWith('unlink', ignoredArg5);
              spy.should.not.have.been.calledWith('unlink', ignoredArg6);
              wClose(watcher);
              done();
            }, 300)();
          }));
      });
    });
    describe('ignorePermissionErrors', function() {
      var filePath;
      beforeEach(function() {
        filePath = getFixturePath('add.txt');
        fs.writeFileSync(filePath, 'b', {mode: 128});
      });
      describe('false', function() {
        beforeEach(function() { options.ignorePermissionErrors = false; });
        it('does not watch files without read permissions', function(done) {
          if (platform === 'win32') return done();
          var spy = sinon.spy();
          var watcher = stdWatcher()
            .on('all', spy)
            .on('ready', w(function() {
              spy.should.not.have.been.calledWith('add', {type: 'add', path: filePath});
              fs.writeFileSync(filePath, Date.now());
              w(function() {
                spy.should.not.have.been.calledWith('change', {type: 'change', path: filePath});
                wClose(watcher);
                done();
              })();
            }));
        });
      });
      describe('true', function() {
        beforeEach(function() { options.ignorePermissionErrors = true; });
        it('watches unreadable files if possible', function(done) {
          var spy = sinon.spy();
          var watcher = stdWatcher()
            .on('all', spy)
            .on('ready', w(function() {
              spy.should.have.been.calledWith('add', {type: 'add', path: filePath});
              if (!options.useFsEvents) return done();
              fs.writeFileSync(filePath, Date.now());
              waitFor([spy.withArgs('change')], function() {
                spy.should.have.been.calledWith('change', {type: 'change', path: filePath});
                wClose(watcher);
                done();
              });
            }));
        });
        it('does not choke on non-existent files', function(done) {
          var watcher = chokidar.watch(getFixturePath('nope.txt'), options)
            .on('ready', function() {
              wClose(watcher);
              done();
            });
        });
      });
    });
    describe('awaitWriteFinish', function() {
      beforeEach(function() {
        options.awaitWriteFinish = {stabilityThreshold: 500};
        options.ignoreInitial = true;
      });
      it('uses default options if none given', function() {
        options.awaitWriteFinish = true;
        var watcher = stdWatcher();
        expect(watcher.options.awaitWriteFinish.pollInterval).to.equal(100);
        expect(watcher.options.awaitWriteFinish.stabilityThreshold).to.equal(2000);
        wClose(watcher);
      });
      it('does not emit add event before a file is fully written', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('add.txt');
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(testPath, 'hello');
            w(function() {
              spy.should.not.have.been.calledWith('add');
              wClose(watcher);
              done();
            }, 300)();
          }));
      });
      it('waits for the file to be fully written before emitting the add event', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('add.txt');
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(testPath, 'hello');
            w(function() {
              spy.should.not.have.been.called;
            }, 300)();
            waitFor([spy], function() {
              spy.should.have.been.calledWith('add', {type: 'add', path: testPath});
              wClose(watcher);
              done();
            });
          }));
      });
      it('emits with the final stats', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('add.txt');
        var testArg = {type: 'change', path: testPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(testPath, 'hello ');
            w(function() {
              fs.appendFileSync(testPath, 'world!');
            }, 300)();
            waitFor([spy], function() {
              spy.should.have.been.calledWith('add', testArg);
              expect(spy.args[0][2].size).to.equal(12);
              wClose(watcher);
              done();
            });
          }));
      });
      it('does not emit change event while a file has not been fully written', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('add.txt');
        var testArg = {type: 'change', path: testPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(testPath, 'hello');
            fs.writeFileSync(testPath, 'edit');
            w(function() {
              spy.should.not.have.been.calledWith('change', testArg);
              wClose(watcher);
              done();
            })();
          }));
      });
      it('does not emit change event before an existing file is fully updated', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('change.txt');
        var testArg = {type: 'change', path: testPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(testPath, 'hello');
            w(function() {
              spy.should.not.have.been.calledWith('change', testArg);
              wClose(watcher);
              done();
            })();
          }));
      });
      it('waits for an existing file to be fully updated before emitting the change event', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('change.txt');
        var testArg = {type: 'change', path: testPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(testPath, 'hello');
            w(function() {
              spy.should.not.have.been.called;
            }, 300)();
            waitFor([spy], function() {
              spy.should.have.been.calledWith('change', testArg);
              wClose(watcher);
              done();
            });
          }));
      });
      it('emits change event after the file is fully written', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('add.txt');
        var testArg = {type: 'add', path: testPath};
        var testArg2 = {type: 'change', path: testPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(testPath, 'hello');
            waitFor([spy], function() {
              spy.should.have.been.calledWith('add', testArg);
              fs.writeFileSync(testPath, 'edit');
              waitFor([spy.withArgs('change')], function() {
                spy.should.have.been.calledWith('change', testArg2);
                wClose(watcher);
                done();
              });
            });
          }));
      });
      it('is compatible with the cwd option', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('subdir/add.txt');
        var testArg = {type: 'add', path: testPath};
        options.cwd = sysPath.dirname(testPath);
        fs.mkdirSync(options.cwd);
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFileSync(testPath, 'hello');
            waitFor([spy.withArgs('add')], function() {
              spy.should.have.been.calledWith('add', testArg);
              wClose(watcher);
              done();
            });
          }, 600));
      });
      it('still emits initial add events', function(done) {
        options.ignoreInitial = false;
        var spy = sinon.spy();
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            spy.should.have.been.calledWith('add');
            spy.should.have.been.calledWith('addDir');
            wClose(watcher);
            done();
          });
      });
      it('emits an unlink event when a file is updated and deleted just after that', function(done) {
        var spy = sinon.spy();
        var unlinkPath = getFixturePath('unlink.txt');
        var unlinkArg = {type: 'unlink', path: unlinkPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', w(function() {
            fs.writeFile(unlinkPath, Date.now(), w(function() {
              fs.unlinkSync(unlinkPath);
            }));
            w(function() {
              spy.should.have.been.calledWith('unlink', unlinkArg);
              wClose(watcher);
              done();
            }, 600)();
          }));
      });
    });
  });
  describe('getWatched', function() {
    it('returns the watched paths', function(done) {
      var expected = {};
      expected[sysPath.dirname(fixturePath)] = [subdir.toString()];
      expected[fixturePath] = ['change.txt', 'unlink.txt'];
      var watcher = stdWatcher()
        .on('ready', function() {
          expect(watcher.getWatched()).to.deep.equal(expected);
          wClose(watcher);
          done();
        });
    });
    it('sets keys relative to cwd & include added paths', function(done) {
      options.cwd = fixturePath;
      var expected = {
        '.': ['change.txt', 'subdir', 'unlink.txt'],
        '..': [subdir.toString()],
        'subdir': []
      };
      fs.mkdirSync(getFixturePath('subdir'));
      var watcher = stdWatcher()
        .on('ready', function() {
          expect(watcher.getWatched()).to.deep.equal(expected);
          wClose(watcher);
          done();
        });
    });
  });
  describe('unwatch', function() {
    beforeEach(function() {
      options.ignoreInitial = true;
      fs.mkdirSync(getFixturePath('subdir'));
    });
    it('stops watching unwatched paths', function(done) {
      var spy = sinon.spy();
      var subdirPath = getFixturePath('subdir');
      var addPath = sysPath.join(subdirPath, 'add.txt');
      var changePath = getFixturePath('change.txt');
      var testArg = {type: 'change', path: changePath};
      var watchPaths = [subdirPath, changePath];
      var watcher = chokidar.watch(watchPaths, options)
        .on('all', spy)
        .on('ready', w(function() {
          watcher.unwatch(subdirPath);
          fs.writeFileSync(addPath, Date.now());
          fs.writeFileSync(changePath, Date.now());
          waitFor([spy], function() {
            spy.should.have.been.calledWith('change', testArg);
            spy.should.not.have.been.calledWith('add');
            if (!osXFsWatch) spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          });
        }));
    });
    it('ignores unwatched paths that are a subset of watched paths', function(done) {
      var spy = sinon.spy();
      var subdirPath = getFixturePath('subdir');
      var addPath = sysPath.join(subdirPath, 'add.txt');
      var changePath = getFixturePath('change.txt');
      var unlinkPath = getFixturePath('unlink.txt');
      var watcher = chokidar.watch(fixturePath, options)
        .on('all', spy)
        .on('ready', w(function() {
          // test with both relative and absolute paths
          var subdirRel = sysPath.relative(process.cwd(), subdirPath);
          watcher.unwatch([subdirRel, getFixturePath('unl*')]);
          fs.unlinkSync(unlinkPath);
          fs.writeFileSync(addPath, Date.now());
          fs.writeFileSync(changePath, Date.now());
          waitFor([spy.withArgs('change')], function() {
            spy.should.have.been.calledWith('change', {type: 'change', path: changePath});
            spy.should.not.have.been.calledWith('add', addPath);
            spy.should.not.have.been.calledWith('unlink');
            wClose(watcher);
            done();
          });
        }));
    });
    it('unwatches relative paths', function(done) {
      var spy = sinon.spy();
      var fixturesDir = sysPath.relative(process.cwd(), fixturePath);
      var subdir = sysPath.join(fixturesDir, 'subdir');
      var changeFile = sysPath.join(fixturesDir, 'change.txt');
      var testArg = {type: 'change', path: changeFile};
      var watchPaths = [subdir, changeFile];
      var watcher = chokidar.watch(watchPaths, options)
        .on('all', spy)
        .on('ready', w(function() {
          watcher.unwatch(subdir);
          fs.writeFileSync(getFixturePath('subdir/add.txt'), Date.now());
          fs.writeFile(getFixturePath('change.txt'), Date.now());
          waitFor([spy], function() {
            spy.should.have.been.calledWith('change', testArg);
            spy.should.not.have.been.calledWith('add');
            if (!osXFsWatch) spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          });
        }));
    });
    it('watches paths that were unwatched and added again', function(done) {
      var spy = sinon.spy();
      var changePath = getFixturePath('change.txt');
      var testArg = {type: 'change', path: changePath};
      var watchPaths = [changePath];
      var watcher = chokidar.watch(watchPaths, options)
        .on('ready', w(function() {
          watcher.unwatch(changePath);
          w(function() {
            watcher.on('all', spy).add(changePath);
            w(function() {
              fs.writeFileSync(changePath, Date.now());
              waitFor([spy], function() {
                spy.should.have.been.calledWith('change', testArg);
                if (!osXFsWatch) spy.should.have.been.calledOnce;
                wClose(watcher);
                done();
              });
            })();
          })();
        }));
    });
    it('unwatches paths that are relative to options.cwd', function(done) {
      options.cwd = fixturePath;
      var spy = sinon.spy();
      var addPath = getFixturePath('subdir/add.txt');
      var changePath = getFixturePath('change.txt');
      var unlinkPath = getFixturePath('unlink.txt');
      var testArg = {type: 'change', path: changePath};
      var watcher = chokidar.watch('.', options)
        .on('all', spy)
        .on('ready', w(function() {
          watcher.unwatch(['subdir', unlinkPath]);
          fs.unlinkSync(unlinkPath);
          fs.writeFileSync(addPath, Date.now());
          fs.writeFileSync(changePath, Date.now());
          waitFor([spy], function() {
            spy.should.have.been.calledWith('change', testArg);
            spy.should.not.have.been.calledWith('add');
            spy.should.not.have.been.calledWith('unlink');
            if (!osXFsWatch) spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          });
        }));
    });
  });
  describe('close', function() {
    it('ignores further events on close', function(done) {
      var spy = sinon.spy();
      var watcher = chokidar.watch(fixturePath, options)
        .once('add', function() {
          watcher.once('add', function() {
            watcher.on('add', spy).close();
            fs.writeFileSync(getFixturePath('add.txt'), Date.now());
            w(function() {
              spy.should.not.have.been.called;
              wClose(watcher);
              done();
            }, 600)();
          });
        })
        .on('ready', function() {
          fs.writeFileSync(getFixturePath('add.txt'), 'hello');
          fs.unlinkSync(getFixturePath('add.txt'));
        });
    });
    it('does not prevent the process from exiting', function(done) {
      var scriptFile = getFixturePath('script.js');
      var scriptContent = '\
var chokidar = require("' + __dirname.replace(/\\/g, '\\\\') + '");\n\
var watcher = chokidar.watch("' + scriptFile.replace(/\\/g, '\\\\') + '");\n\
watcher.close();\n\
process.stdout.write("closed");\n\
';
      fs.writeFile(scriptFile, scriptContent, function(err) {
        if (err) throw err;
        cp.exec('node ' + scriptFile, function(err, stdout) {
          if (err) throw err;
          expect(stdout.toString()).to.equal('closed');
          done();
        });
      });
    });
  });
  describe('env variable option override', function() {
    describe('CHOKIDAR_USEPOLLING', function() {
      afterEach(function() {
        delete process.env.CHOKIDAR_USEPOLLING;
      });
      it('makes options.usePolling `true` when CHOKIDAR_USEPOLLING is set to true', function(done) {
        options.usePolling = false;
        process.env.CHOKIDAR_USEPOLLING = true;
        var watcher = chokidar.watch(fixturePath, options)
          .on('ready', function() {
            watcher.options.usePolling.should.be.true;
            wClose(watcher);
            done();
          });
      });
      it('makes options.usePolling `true` when CHOKIDAR_USEPOLLING is set to 1', function(done) {
        options.usePolling = false;
        process.env.CHOKIDAR_USEPOLLING = 1;
        var watcher = chokidar.watch(fixturePath, options)
          .on('ready', function() {
            watcher.options.usePolling.should.be.true;
            wClose(watcher);
            done();
          });
      });
      it('makes options.usePolling `false` when CHOKIDAR_USEPOLLING is set to false', function(done) {
        options.usePolling = true;
        process.env.CHOKIDAR_USEPOLLING = false;
        var watcher = chokidar.watch(fixturePath, options)
          .on('ready', function() {
            watcher.options.usePolling.should.be.false;
            wClose(watcher);
            done();
          });
      });
      it('makes options.usePolling `false` when CHOKIDAR_USEPOLLING is set to 0', function(done) {
        options.usePolling = true;
        process.env.CHOKIDAR_USEPOLLING = false;
        var watcher = chokidar.watch(fixturePath, options)
          .on('ready', function() {
            watcher.options.usePolling.should.be.false;
            wClose(watcher);
            done();
          });
      });
      it('does not attenuate options.usePolling when CHOKIDAR_USEPOLLING is set to an arbitrary value', function(done) {
        options.usePolling = true;
        process.env.CHOKIDAR_USEPOLLING = 'foo';
        var watcher = chokidar.watch(fixturePath, options)
          .on('ready', function() {
            watcher.options.usePolling.should.be.true;
            wClose(watcher);
            done();
          });
      });
    });
    describe('CHOKIDAR_INTERVAL', function() {
      afterEach(function() {
        delete process.env.CHOKIDAR_INTERVAL;
      });
      it('makes options.interval = CHOKIDAR_INTERVAL when it is set', function(done) {
        options.interval = 100;
        process.env.CHOKIDAR_INTERVAL = 1500;
        var watcher = chokidar.watch(fixturePath, options)
          .on('ready', function() {
            watcher.options.interval.should.be.equal(1500);
            wClose(watcher);
            done();
          });
      });
    });
  });
  describe('non-persistent', function() {
    beforeEach(function() {
      options.persistent = false;
    });
    after(function() {
      options.persistent = true;
    });
    if (baseopts.useFsEvents) {
      it('does not emit events after the initial watch event when using fsevents', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('unlink.txt');
        var watcher = stdWatcher()
          .on('unlink', spy)
          .on('ready', w(function() {
            fs.unlinkSync(testPath);
            w(function() {
              spy.should.not.have.been.called;
              wClose(watcher);
              done();
            })();
          }));
      });
    }
    if (!baseopts.useFsEvents) {
      it('emits events after the initial watch event when using fs.watch or fs.watchFile', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('unlink.txt');
        var watcher = stdWatcher()
          .on('unlink', spy)
          .on('ready', w(function() {
            fs.unlinkSync(testPath);
            w(function() {
              spy.should.have.been.called;
              wClose(watcher);
              done();
            })();
          }));
      });
    }
  });
}
