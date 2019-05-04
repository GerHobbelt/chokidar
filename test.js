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
var osMajor = parseInt(os.release().split('.')[0], 10);
var platform = process.platform;

var fixturesPath = getFixturePath('');
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

before(function(done) {
  var writtenCount = 0;
  function wrote(err) {
    if (err) throw err;
    if (++writtenCount === testCount * 2) {
      subdir = 0;
      done();
    }
  }
  rimraf(sysPath.join(__dirname, 'test-fixtures'), function(err) {
    if (err) throw err;
    fs.mkdir(fixturesPath, function(err) {
      if (err) throw err;
      while (subdir < testCount) {
        subdir++;
        fixturesPath = getFixturePath('');
        fs.mkdir(fixturesPath, function() {
          fs.writeFile(sysPath.join(this, 'change.txt'), 'b', wrote);
          fs.writeFile(sysPath.join(this, 'unlink.txt'), 'b', wrote);
        }.bind(fixturesPath));
      }
    });
  });
});

beforeEach(function() {
  subdir++;
  fixturesPath = getFixturePath('');
});

afterEach(function() {
  sinon.restore();
});

describe('chokidar', function() {
  this.timeout(6000);
  it('should expose public API methods', function() {
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

function simpleCb(err) { if (err) throw err; }
function w(fn, to) {
  return setTimeout.bind(null, fn, to || slowerDelay || 50);
}

function runTests(baseopts) {
  baseopts.persistent = true;

  before(function() {
    // flags for bypassing special-case test failures on CI
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
    return chokidar.watch(fixturesPath, options);
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
    // If using fsevents (compiled C code), closing watchers too many times in succession will segfault.
    // On the other hand, leaving them open and reinstantiating new watchers will consolidate watchers if the number of
    // watched child paths under a parent path exceeds a threshold (10).
    // For this test (far more watchers than most use-cases), memory usage will be minimal (<20MB on Node 11).
    if (!baseopts.useFsEvents) {
      watcher.close();
    }
  }

  describe('instantiate correctly', function() {
    it('should produce an instance of chokidar.FSWatcher', function() {
      var watcher = stdWatcher();
      watcher.should.be.an['instanceof'](chokidar.FSWatcher);
      wClose(watcher);
    });
    it('should expose public API methods', function() {
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
    it('should emit `add` event when file was added', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('add.txt');
      var testArg = {type: 'add', path: testPath};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('raw', rawSpy)
        .on('add', spy)
        .on('ready', function() {
          fs.writeFile(testPath, Date.now(), simpleCb);
          waitFor([spy], function() {
            spy.should.have.been.calledOnce;
            spy.should.have.been.calledWith(testArg);
            expect(spy.args[0][1]).to.be.ok; // stats
            rawSpy.should.have.been.called;
            wClose(watcher);
            done();
          });
        });
    });
    it('should emit `addDir` event when directory was added', function(done) {
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testArg = {type: 'addDir', path: testDir};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('raw', rawSpy)
        .on('addDir', spy)
        .on('ready', function() {
          spy.should.not.have.been.called;
          fs.mkdir(testDir, simpleCb);
          waitFor([spy], function() {
            spy.should.have.been.calledOnce;
            spy.should.have.been.calledWith(testArg);
            expect(spy.args[0][1]).to.be.ok; // stats
            rawSpy.should.have.been.called;
            wClose(watcher);
            done();
          });
        });
    });
    it('should emit `change` event when file was changed', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('change.txt');
      var testArg = {type: 'change', path: testPath};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('raw', rawSpy)
        .on('change', spy)
        .on('ready', function() {
          spy.should.not.have.been.called;
          fs.writeFile(testPath, Date.now(), simpleCb);
          waitFor([spy], function() {
            spy.should.have.been.calledWith(testArg);
            expect(spy.args[0][1]).to.be.ok; // stats
            rawSpy.should.have.been.called;
            spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          });
        });
    });
    it('should emit `unlink` event when file was removed', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('unlink.txt');
      var testArg = {type: 'unlink', path: testPath};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('raw', rawSpy)
        .on('unlink', spy)
        .on('ready', function() {
          spy.should.not.have.been.called;
          fs.unlink(testPath, simpleCb);
          waitFor([spy], function() {
            spy.should.have.been.calledWith(testArg);
            expect(spy.args[0][1]).to.not.be.ok; // no stats
            rawSpy.should.have.been.called;
            spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          });
        });
    });
    it('should emit `unlinkDir` event when a directory was removed', function(done) {
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testArg = {type: 'unlinkDir', path: testDir};
      fs.mkdirSync(testDir);
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('raw', rawSpy)
        .on('unlinkDir', spy)
        .on('ready', function() {
          w(fs.rmdir.bind(fs, testDir, simpleCb))();
          waitFor([spy], function() {
            spy.should.have.been.calledWith(testArg);
            expect(spy.args[0][1]).to.not.be.ok; // no stats
            rawSpy.should.have.been.called;
            spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          });
        });
    });
    it('should emit `unlink` and `add` events when a file is renamed', function(done) {
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
        .on('ready', function() {
          unlinkSpy.should.not.have.been.called;
          addSpy.should.not.have.been.called;
          w(fs.rename.bind(fs, testPath, newPath, simpleCb))();
          waitFor([
            unlinkSpy,
            addSpy
          ], function() {
            unlinkSpy.should.have.been.calledWith(unlinkArg);
            expect(unlinkSpy.args[0][1]).to.not.be.ok; // no stats
            rawSpy.should.have.been.called;
            if (!osXFsWatch) unlinkSpy.should.have.been.calledOnce;
            addSpy.should.have.been.calledOnce;
            addSpy.should.have.been.calledWith(addArg);
            expect(addSpy.args[0][1]).to.be.ok; // stats
            wClose(watcher);
            done();
          });
        });
    });
    it('should emit `unlinkDir` when a directory was renamed', function(done) {
      var unlinkDirSpy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testDir2 = getFixturePath('subdir2');
      var testFile = sysPath.join(testDir, 'add.txt');
      var testArg = {type: 'unlinkDir', path: testDir};
      fs.mkdir(testDir, function() {
        fs.writeFile(testFile, Date.now(), function() {
          var watcher = stdWatcher()
            .on('ready', readySpy)
            .on('unlinkDir', unlinkDirSpy)
            .on('ready', function() {
              fs.rename(testDir, testDir2, simpleCb);
              waitFor([unlinkDirSpy.withArgs(testArg)], function() {
                unlinkDirSpy.withArgs(testArg).should.have.been.calledOnce;
                wClose(watcher);
                done();
              });
            });
        });
      });
    });
    if (!baseopts.useFsEvents && !baseopts.usePolling) {
      it('should emit `unlinkDir` when a directory was renamed and renamed back to its original name', function(done) {
        var unlinkDirSpy = sinon.spy();
        var testDir = getFixturePath('subdir');
        var testDir2 = getFixturePath('subdir2');
        var testFile = sysPath.join(testDir, 'add.txt');
        var testArg = {type: 'unlinkDir', path: testDir};
        var testArg2 = {type: 'unlinkDir', path: testDir2};
        fs.mkdir(testDir, function() {
          fs.writeFile(testFile, Date.now(), function() {
            var watcher = stdWatcher()
              .on('ready', readySpy)
              .on('unlinkDir', unlinkDirSpy)
              .on('ready', function() {
                fs.rename(testDir, testDir2, w(function() {
                  fs.rename(testDir2, testDir, simpleCb);
                }));
                waitFor([unlinkDirSpy.withArgs(testArg)], function() {
                  unlinkDirSpy.withArgs(testArg).should.have.been.calledOnce;
                });
                waitFor([unlinkDirSpy.withArgs(testArg2)], function() {
                  unlinkDirSpy.withArgs(testArg2).should.have.been.calledOnce;
                  wClose(watcher);
                  done();
                });
              });
          });
        });
      });
    }
    it('should emit `add`, not `change`, when previously deleted file is re-added', function(done) {
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
        .on('ready', function() {
          unlinkSpy.should.not.have.been.called;
          addSpy.should.not.have.been.called;
          changeSpy.should.not.have.been.called;
          fs.unlink(testPath, simpleCb);
          waitFor([unlinkSpy.withArgs(unlinkArg)], function() {
            unlinkSpy.should.have.been.calledWith(unlinkArg);
            w(fs.writeFile.bind(fs, testPath, Date.now(), simpleCb))();
            waitFor([addSpy.withArgs(addArg)], function() {
              addSpy.should.have.been.calledWith(addArg);
              changeSpy.should.not.have.been.called;
              wClose(watcher);
              done();
            });
          });
        });
    });
    it('should not emit `unlink` for previously moved files', function(done) {
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
        .on('ready', function() {
          fs.rename(testPath, newPath1, w(function() {
            fs.rename(newPath1, newPath2, simpleCb);
          }, 300));
          waitFor([unlinkSpy.withArgs(newPath1)], function() {
            unlinkSpy.withArgs(testArg).should.have.been.calledOnce;
            unlinkSpy.withArgs(testArg1).should.have.been.calledOnce;
            unlinkSpy.withArgs(testArg2).should.not.have.been.called;
            wClose(watcher);
            done();
          });
        });
    });
    it('should survive ENOENT for missing subdirectories', function(done) {
      var testDir = getFixturePath('notadir');
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('ready', function() {
          watcher.add(testDir);
          wClose(watcher);
          done();
        });
    });
    it('should notice when a file appears in a new directory', function(done) {
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testPath = getFixturePath('subdir/add.txt');
      var testArg = {type: 'add', path: testPath};
      var watcher = stdWatcher()
        .on('ready', readySpy)
        .on('add', spy)
        .on('ready', function() {
          spy.should.not.have.been.called;
          fs.mkdir(testDir, function() {
            fs.writeFile(testPath, Date.now(), simpleCb);
          });
          waitFor([spy], function() {
            spy.should.have.been.calledOnce;
            spy.should.have.been.calledWith(testArg);
            expect(spy.args[0][1]).to.be.ok; // stats
            wClose(watcher);
            done();
          });
        });
    });
    it('should watch removed and re-added directories', function(done) {
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
        .on('ready', function() {
          fs.mkdir(parentPath, w(function() {
            fs.rmdir(parentPath, simpleCb);
          }, win32Polling ? 900 : 300));
          waitFor([unlinkSpy], function() {
            unlinkSpy.should.have.been.calledWith(unlinkArg);
            fs.mkdir(parentPath, w(function() {
              fs.mkdir(subPath, simpleCb);
            }, win32Polling ? 2200 : 1200));
            waitFor([[addSpy, 3]], function() {
              addSpy.should.have.been.calledWith(addParentArg);
              addSpy.should.have.been.calledWith(addSubArg);
              wClose(watcher);
              done();
            });
          });
        });
    });
  });
  describe('watch individual files', function() {
    it('should detect changes', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('change.txt');
      var testArg = {type: 'change', path: testPath};
      var watcher = chokidar.watch(testPath, options)
        .on('change', spy)
        .on('ready', function() {
          fs.writeFile(testPath, Date.now(), simpleCb);
          waitFor([spy], function() {
            spy.should.have.always.been.calledWith(testArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should detect unlinks', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('unlink.txt');
      var testArg = {type: 'unlink', path: testPath};
      var watcher = chokidar.watch(testPath, options)
        .on('unlink', spy)
        .on('ready', function() {
          w(fs.unlink.bind(fs, testPath, simpleCb))();
          waitFor([spy], function() {
            spy.should.have.been.calledWith(testArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should detect unlink and re-add', function(done) {
      options.ignoreInitial = true;
      var unlinkSpy = sinon.spy();
      var addSpy = sinon.spy();
      var testPath = getFixturePath('unlink.txt');
      var unlinkArg = {type: 'unlink', path: testPath};
      var addArg = {type: 'add', path: testPath};
      var watcher = chokidar.watch(testPath, options)
        .on('unlink', unlinkSpy)
        .on('add', addSpy)
        .on('ready', function() {
          w(fs.unlink.bind(fs, testPath, simpleCb))();
          waitFor([unlinkSpy], function() {
            unlinkSpy.should.have.been.calledWith(unlinkArg);
            w(fs.writeFile.bind(fs, testPath, 're-added', simpleCb))();
            waitFor([addSpy], function() {
              addSpy.should.have.been.calledWith(addArg);
              wClose(watcher);
              done();
            });
          });
        });
    });
    it('should ignore unwatched siblings', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('add.txt');
      var siblingPath = getFixturePath('change.txt');
      var testArg = {type: 'add', path: testPath};
      var watcher = chokidar.watch(testPath, options)
        .on('all', spy)
        .on('ready', function() {
          w(function() {
            fs.writeFile(siblingPath, Date.now(), simpleCb);
            fs.writeFile(testPath, Date.now(), simpleCb);
          })();
          waitFor([spy], function() {
            spy.should.have.always.been.calledWith('add', testArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should ignore the ".." path within a watched directory', function(done) {
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testFile = getFixturePath('add.txt');
      fs.mkdirSync(testDir);
      var watcher = chokidar.watch(testDir, options)
        .on('add', spy)
        .on('ready', function() {
          fs.writeFile(testFile, Date.now(), simpleCb);
          w(function() {
            spy.should.not.have.been.called;
            wClose(watcher);
            done();
          }, 1000)();
        });
    });
    it('should ignore the ".." path within a watched directory using the cwd option', function(done) {
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testFile = getFixturePath('add.txt');
      options.cwd = testDir;
      fs.mkdirSync(testDir);
      var watcher = chokidar.watch('**', options)
        .on('add', spy)
        .on('ready', function() {
          fs.writeFile(testFile, Date.now(), simpleCb);
          w(function() {
            spy.should.not.have.been.called;
            wClose(watcher);
            done();
          }, 1000)();
        });
    });
  });
  describe('renamed directory', function() {
    it('should emit `add` for a file in a renamed directory', function(done) {
      options.ignoreInitial = true;
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testPath = getFixturePath('subdir/add.txt');
      var renamedDir = getFixturePath('subdir-renamed');
      var expectedPath = sysPath.join(renamedDir, 'add.txt');
      var testArg = {type: 'add', path: expectedPath};
      fs.mkdirSync(testDir);
      fs.writeFileSync(testPath, Date.now());
      var watcher = chokidar.watch(fixturesPath, options)
        .on('add', spy)
        .on('ready', function() {
          w(fs.rename.bind(fs, testDir, renamedDir, simpleCb), 1000)();
          waitFor([spy], function() {
            spy.should.have.been.calledOnce;
            spy.should.have.been.calledWith(testArg);
            wClose(watcher);
            done();
          });
        });
    });
  });
  describe('watch non-existent paths', function() {
    it('should watch non-existent file and detect add', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('add.txt');
      var testArg = {type: 'add', path: testPath};
      var watcher = chokidar.watch(testPath, options)
        .on('add', spy)
        .on('ready', function() {
          w(fs.writeFile.bind(fs, testPath, Date.now(), simpleCb))();
          waitFor([spy], function() {
            spy.should.have.been.calledWith(testArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should watch non-existent dir and detect addDir/add', function(done) {
      var spy = sinon.spy();
      var testDir = getFixturePath('subdir');
      var testPath = getFixturePath('subdir/add.txt');
      var testDirArg = {type: 'addDir', path: testDir};
      var testPathArg = {type: 'add', path: testPath};
      var watcher = chokidar.watch(testDir, options)
        .on('all', spy)
        .on('ready', function() {
          spy.should.not.have.been.called;
          w(function() {
            fs.mkdir(testDir, w(function() {
              fs.writeFile(testPath, 'hello', simpleCb);
            }));
          })();
          waitFor([spy.withArgs('add')], function() {
            spy.should.have.been.calledWith('addDir', testDirArg);
            spy.should.have.been.calledWith('add', testPathArg);
            wClose(watcher);
            done();
          });
        });
    });
  });
  describe('watch glob patterns', function() {
    it('should correctly watch and emit based on glob input', function(done) {
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
        .on('ready', function() {
          spy.should.have.been.calledWith('add', addArg);
          w(function() {
            fs.writeFile(addPath, Date.now(), simpleCb);
            fs.writeFile(changePath, Date.now(), simpleCb);
          })();
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
        });
    });
    it('should respect negated glob patterns', function(done) {
      var spy = sinon.spy();
      var testPath = getFixturePath('*');
      var negatedPath = '!' + getFixturePath('*a*.txt');
      var unlinkPath = getFixturePath('unlink.txt');
      var addArg = {type: 'add', path: unlinkPath};
      var unlinkArg = {type: 'unlink', path: unlinkPath};
      var watcher = chokidar.watch([testPath, negatedPath], options)
        .on('all', spy)
        .on('ready', function() {
          spy.should.have.been.calledOnce;
          spy.should.have.been.calledWith('add', addArg);
          w(fs.unlink.bind(fs, unlinkPath, simpleCb))();
          waitFor([
            [spy, 2],
            spy.withArgs('unlink')
          ], function() {
            spy.should.have.been.calledTwice;
            spy.should.have.been.calledWith('unlink', unlinkArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should traverse subdirs to match globstar patterns', function(done) {
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
      w(function() {
        var watcher = chokidar.watch(watchPath, options)
          .on('all', spy)
          .on('ready', function() {
            w(function() {
              fs.writeFile(addPath, Date.now(), simpleCb);
              fs.writeFile(abPath, Date.now(), simpleCb);
              fs.unlink(aPath, simpleCb);
              fs.unlink(bPath, simpleCb);
            })();
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
          });
      })();
    });
    it('should resolve relative paths with glob patterns', function(done) {
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
        .on('ready', function() {
          spy.should.have.been.calledWith('add', addArg);
          w(function() {
            fs.writeFile(addPath, Date.now(), simpleCb);
            fs.writeFile(changePath, Date.now(), simpleCb);
          })();
          waitFor([
            [spy, 3],
            spy.withArgs('add', addPath)
          ], function() {
            spy.should.have.been.calledWith('add', addArg2);
            spy.should.have.been.calledWith('change', changeArg);
            spy.should.not.have.been.calledWith('add', unlinkArg);
            spy.should.not.have.been.calledWith('addDir');
            if (!osXFsWatch) spy.should.have.been.calledThrice;
            wClose(watcher);
            done();
          });
        });
    });
    it('should correctly handle conflicting glob patterns', function(done) {
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
        .on('ready', function() {
          spy.should.have.been.calledWith('add', addArg);
          spy.should.have.been.calledWith('add', addArg2);
          spy.should.have.been.calledTwice;
          w(function() {
            fs.writeFile(addPath, Date.now(), simpleCb);
            fs.writeFile(changePath, Date.now(), simpleCb);
            fs.unlink(unlinkPath, simpleCb);
          })();
          waitFor([
            [spy, 4],
            spy.withArgs('unlink', unlinkPath)
          ], function() {
            spy.should.have.been.calledWith('change', changeArg);
            spy.should.have.been.calledWith('unlink', unlinkArg);
            spy.should.not.have.been.calledWith('add', addArg3);
            if (!osXFsWatch) spy.callCount.should.equal(4);
            wClose(watcher);
            done();
          });
        });
    });
    it('should correctly handle intersecting glob patterns', function(done) {
      var spy = sinon.spy();
      var changePath = getFixturePath('change.txt');
      var watchPaths = [getFixturePath('cha*'), getFixturePath('*nge.*')];
      var addArg = {type: 'add', path: changePath};
      var changeArg = {type: 'change', path: changePath};
      var watcher = chokidar.watch(watchPaths, options)
        .on('all', spy)
        .on('ready', function() {
          spy.should.have.been.calledWith('add', addArg);
          spy.should.have.been.calledOnce;
          w(fs.writeFile.bind(fs, changePath, Date.now(), simpleCb))();
          waitFor([[spy, 2]], function() {
            spy.should.have.been.calledWith('change', changeArg);
            spy.should.have.been.calledTwice;
            wClose(watcher);
            done();
          });
        });
    });
    it('should not confuse glob-like filenames with globs', function(done) {
      var spy = sinon.spy();
      var filePath = getFixturePath('nota[glob].txt');
      var addArg = {type: 'add', path: filePath};
      var changeArg = {type: 'change', path: filePath};
      fs.writeFileSync(filePath, 'b');
      var watcher = stdWatcher()
        .on('all', spy)
        .on('ready', function() {
          spy.should.have.been.calledWith('add', addArg);
          w(fs.writeFile.bind(fs, filePath, Date.now(), simpleCb))();
          waitFor([spy.withArgs('change', filePath)], function() {
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should treat glob-like directory names as literal directory names when globbing is disabled', function(done) {
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
        .on('ready', function() {
          spy.should.have.been.calledWith('add', addArg);
          spy.should.not.have.been.calledWith('add', addArg2);
          spy.should.not.have.been.calledWith('add', addArg3);
          spy.should.not.have.been.calledWith('addDir', addDirArg);
          w(fs.writeFile.bind(fs, filePath, Date.now(), simpleCb))();
          waitFor([spy.withArgs('change', filePath)], function() {
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should treat glob-like filenames as literal filenames when globbing is disabled', function(done) {
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
        .on('ready', function() {
          spy.should.have.been.calledWith('add', addArg);
          spy.should.not.have.been.calledWith('add', addArg2);
          spy.should.not.have.been.calledWith('add', addArg3);
          spy.should.not.have.been.calledWith('addDir', addDirArg);
          w(fs.writeFile.bind(fs, filePath, Date.now(), simpleCb))();
          waitFor([spy.withArgs('change', filePath)], function() {
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should not prematurely filter dirs against complex globstar patterns', function(done) {
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
        .on('ready', function() {
          w(fs.writeFile.bind(fs, deepFile, Date.now(), simpleCb))();
          waitFor([[spy, 2]], function() {
            spy.should.have.been.calledWith('add', addArg);
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should emit matching dir events', function(done) {
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
        .on('ready', function() {
          spy.should.have.been.calledWith('addDir', addDirArg);
          spy.withArgs('addDir').should.have.been.calledOnce;
          fs.mkdirSync(deepDir);
          fs.writeFileSync(deepFile, Date.now());
          waitFor([
            [spy.withArgs('addDir'), 2],
            spy.withArgs('add', deepFile)
          ], function() {
            if (win32Polling) return done();
            spy.should.have.been.calledWith('addDir', addDirArg2);
            fs.unlinkSync(deepFile);
            fs.rmdirSync(deepDir);
            waitFor([spy.withArgs('unlinkDir')], function() {
              spy.should.have.been.calledWith('unlinkDir', unlinkDirArg);
              wClose(watcher);
              done();
            });
          });
        });
    });
  });
  describe('watch symlinks', function() {
    if (os === 'win32') return;
    var linkedDir;
    beforeEach(function(done) {
      linkedDir = sysPath.resolve(fixturesPath, '..', subdir + '-link');
      fs.symlink(fixturesPath, linkedDir, function() {
        fs.mkdir(getFixturePath('subdir'), function() {
          fs.writeFile(getFixturePath('subdir/add.txt'), 'b', done);
        });
      });
    });
    afterEach(function(done) {
      fs.unlink(linkedDir, done);
    });
    it('should watch symlinked dirs', function(done) {
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
    it('should watch symlinked files', function(done) {
      var spy = sinon.spy();
      var changePath = getFixturePath('change.txt');
      var linkPath = getFixturePath('link.txt');
      var addArg = {type: 'add', path: linkPath};
      var changeArg = {type: 'change', path: linkPath};
      fs.symlinkSync(changePath, linkPath);
      var watcher = chokidar.watch(linkPath, options)
        .on('all', spy)
        .on('ready', function() {
          fs.writeFile(changePath, Date.now(), simpleCb);
          waitFor([spy.withArgs('change')], function() {
            spy.should.have.been.calledWith('add', addArg);
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should follow symlinked files within a normal dir', function(done) {
      var spy = sinon.spy();
      var changePath = getFixturePath('change.txt');
      var testDir = getFixturePath('subdir');
      var linkPath = sysPath.join(testDir, 'link.txt');
      var addArg = {type: 'add', path: linkPath};
      var changeArg = {type: 'change', path: linkPath};
      fs.symlinkSync(changePath, linkPath);
      var watcher = chokidar.watch(getFixturePath('subdir'), options)
        .on('all', spy)
        .on('ready', function() {
          fs.writeFile(changePath, Date.now(), simpleCb);
          waitFor([spy.withArgs('change', linkPath)], function() {
            spy.should.have.been.calledWith('add', addArg);
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should watch paths with a symlinked parent', function(done) {
      var spy = sinon.spy();
      var testDir = sysPath.join(linkedDir, 'subdir');
      var testFile = sysPath.join(testDir, 'add.txt');
      var addDirArg = {type: 'addDir', path: testDir};
      var addArg = {type: 'add', path: testFile};
      var changeArg = {type: 'change', path: testFile};
      var watcher = chokidar.watch(testDir, options)
        .on('all', spy)
        .on('ready', function() {
          spy.should.have.been.calledWith('addDir', addDirArg);
          spy.should.have.been.calledWith('add', addArg);
          fs.writeFile(getFixturePath('subdir/add.txt'), Date.now(), simpleCb);
          waitFor([spy.withArgs('change')], function() {
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should not recurse indefinitely on circular symlinks', function(done) {
      fs.symlinkSync(fixturesPath, getFixturePath('subdir/circular'));
      stdWatcher().on('ready', done);
    });
    it('should recognize changes following symlinked dirs', function(done) {
      var spy = sinon.spy();
      var watcher = chokidar.watch(linkedDir, options)
        .on('change', spy)
        .on('ready', function() {
          var linkedFilePath = sysPath.join(linkedDir, 'change.txt');
          var testArg = {type: 'change', path: linkedFilePath};
          fs.writeFile(getFixturePath('change.txt'), Date.now(), simpleCb);
          waitFor([spy.withArgs(linkedFilePath)], function() {
            spy.should.have.been.calledWith(testArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should follow newly created symlinks', function(done) {
      options.ignoreInitial = true;
      var spy = sinon.spy();
      var testDir = getFixturePath('link');
      var testPath = getFixturePath('link/add.txt');
      var testDirArg = {type: 'addDir', path: testDir};
      var testPathArg = {type: 'add', path: testPath};
      var watcher = stdWatcher()
        .on('all', spy)
        .on('ready', function() {
          w(fs.symlink.bind(fs, getFixturePath('subdir'), testDir, simpleCb))();
          waitFor([
            spy.withArgs('add', testPath),
            spy.withArgs('addDir', testDir)
          ], function() {
            spy.should.have.been.calledWith('addDir', testDirArg);
            spy.should.have.been.calledWith('add', testPathArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should watch symlinks as files when followSymlinks:false', function(done) {
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
    it('should watch symlinks within a watched dir as files when followSymlinks:false', function(done) {
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
        .on('ready', function() {
          w(function() {
            fs.writeFileSync(testPath, Date.now());
            fs.unlinkSync(linkPath);
            fs.symlinkSync(testPath, linkPath);
          }, options.usePolling ? 1200 : 300)();
          waitFor([spy.withArgs('change', linkPath)], function() {
            spy.should.have.been.calledWith('add', addArg);
            spy.should.have.been.calledWith('add', addArg2);
            spy.should.have.been.calledWith('change', changeArg);
            spy.should.not.have.been.calledWith('addDir', addDirArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should not reuse watcher when following a symlink to elsewhere', function(done) {
      var spy = sinon.spy();
      var linkedPath = getFixturePath('outside');
      var linkedFilePath = sysPath.join(linkedPath, 'text.txt');
      var linkPath = getFixturePath('subdir/subsub');
      fs.mkdirSync(linkedPath);
      fs.writeFileSync(linkedFilePath, 'b');
      fs.symlinkSync(linkedPath, linkPath);
      var watcher2 = chokidar.watch(getFixturePath('subdir'), options)
        .on('ready', w(function() {
          var watchedPath = getFixturePath('subdir/subsub/text.txt');
          var testArg = {type: 'change', path: watchedPath};
          var watcher = chokidar.watch(watchedPath, options)
            .on('all', spy)
            .on('ready', w(function() {
              fs.writeFile(linkedFilePath, Date.now(), simpleCb);
              waitFor([spy.withArgs('change')], function() {
                spy.should.have.been.calledWith('change', testArg);
                wClose(watcher);
                wClose(watcher2);
                done();
              });
            }));
        }, options.usePolling ? 900 : null));
    });
    it('should properly match glob patterns that include a symlinked dir', function(done) {
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
        .on('ready', function() {
          // only the children are matched by the glob pattern, not the link itself
          addSpy.should.have.been.calledWith(changeArg);
          addSpy.should.have.been.calledThrice; // also unlink.txt & subdir/add.txt
          dirSpy.should.have.been.calledWith(subdirArg);
          fs.writeFile(addPath, simpleCb);
          waitFor([[addSpy, 4]], function() {
            addSpy.should.have.been.calledWith(addArg);
            wClose(watcher);
            done();
          });
        });
    });
  });
  describe('watch arrays of paths/globs', function() {
    it('should watch all paths in an array', function(done) {
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
        .on('ready', function() {
          spy.should.have.been.calledWith('add', addArg);
          spy.should.have.been.calledWith('addDir', addDirArg);
          spy.should.not.have.been.calledWith('add', unlinkArg);
          fs.writeFile(testPath, Date.now(), simpleCb);
          waitFor([spy.withArgs('change')], function() {
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should accommodate nested arrays in input', function(done) {
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
        .on('ready', function() {
          spy.should.have.been.calledWith('add', addArg);
          spy.should.have.been.calledWith('addDir', addDirArg);
          spy.should.not.have.been.calledWith('add', unlinkArg);
          fs.writeFile(testPath, Date.now(), simpleCb);
          waitFor([spy.withArgs('change')], function() {
            spy.should.have.been.calledWith('change', changeArg);
            wClose(watcher);
            done();
          });
        });
    });
    it('should throw if provided any non-string paths', function() {
      expect(chokidar.watch.bind(null, [[fixturesPath], /notastring/]))
        .to.throw(TypeError, /non-string/i);
    });
  });
  describe('watch options', function() {
    describe('ignoreInitial', function() {
      describe('false', function() {
        beforeEach(function() { options.ignoreInitial = false; });
        it('should emit `add` events for preexisting files', function(done) {
          var spy = sinon.spy();
          var watcher = chokidar.watch(fixturesPath, options)
            .on('add', spy)
            .on('ready', function() {
              spy.should.have.been.calledTwice;
              wClose(watcher);
              done();
            });
        });
        it('should emit `addDir` event for watched dir', function(done) {
          var spy = sinon.spy();
          var watcher = chokidar.watch(fixturesPath, options)
            .on('addDir', spy)
            .on('ready', function() {
              spy.should.have.been.calledOnce;
              spy.should.have.been.calledWith({type: 'addDir', path: fixturesPath});
              wClose(watcher);
              done();
            });
        });
        it('should emit `addDir` events for preexisting dirs', function(done) {
          var spy = sinon.spy();
          var parentPath = getFixturePath('subdir');
          var subPath = getFixturePath('subdir/subsub');
          var parentArg = {type: 'addDir', path: parentPath};
          var subArg = {type: 'addDir', path: subPath};
          fs.mkdirSync(parentPath);
          fs.mkdirSync(subPath);
          var watcher = chokidar.watch(fixturesPath, options)
            .on('addDir', spy)
            .on('ready', function() {
              spy.should.have.been.calledWith({type: 'addDir', path: fixturesPath});
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
        it('should ignore inital add events', function(done) {
          var spy = sinon.spy();
          var watcher = stdWatcher()
            .on('add', spy)
            .on('ready', w(function() {
              spy.should.not.have.been.called;
              wClose(watcher);
              done();
            }));
        });
        it('should ignore add events on a subsequent .add()', function(done) {
          var spy = sinon.spy();
          var watcher = chokidar.watch(getFixturePath('subdir'), options)
            .on('add', spy)
            .on('ready', function() {
              watcher.add(fixturesPath);
              w(function() {
                spy.should.not.have.been.called;
                wClose(watcher);
                done();
              }, 1000)();
            });
        });
        it('should notice when a file appears in an empty directory', function(done) {
          var spy = sinon.spy();
          var testDir = getFixturePath('subdir');
          var testPath = getFixturePath('subdir/add.txt');
          var testArg = {type: 'add', path: testPath};
          var watcher = stdWatcher()
            .on('add', spy)
            .on('ready', function() {
              spy.should.not.have.been.called;
              fs.mkdir(testDir, function() {
                fs.writeFile(testPath, Date.now(), simpleCb);
              });
              waitFor([spy], function() {
                spy.should.have.been.calledOnce;
                spy.should.have.been.calledWith(testArg);
                wClose(watcher);
                done();
              });
            });
        });
        it('should emit a change on a preexisting file as a change', function(done) {
          var spy = sinon.spy();
          var testPath = getFixturePath('change.txt');
          var testArg = {type: 'change', path: testPath};
          var watcher = stdWatcher()
            .on('all', spy)
            .on('ready', function() {
              spy.should.not.have.been.called;
              fs.writeFile(testPath, Date.now(), simpleCb);
              waitFor([spy.withArgs('change', testPath)], function() {
                spy.should.have.been.calledWith('change', testArg);
                spy.should.not.have.been.calledWith('add');
                wClose(watcher);
                done();
              });
            });
        });
        it('should not emit for preexisting dirs when depth is 0', function(done) {
          options.depth = 0;
          var spy = sinon.spy();
          var testPath = getFixturePath('add.txt');
          var testArg = {type: 'add', path: testPath};
          fs.mkdirSync(getFixturePath('subdir'));
          w(function() {
            var watcher = stdWatcher()
              .on('all', spy)
              .on('ready', function() {
                fs.writeFile(testPath, Date.now(), simpleCb);
                waitFor([spy], function() {
                  spy.should.have.been.calledWith('add', testArg);
                  spy.should.not.have.been.calledWith('addDir');
                  wClose(watcher);
                  done();
                });
              });
          }, 200)();
        });
      });
    });
    describe('ignored', function() {
      it('should check ignore after stating', function(done) {
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
            if (os !== 'win32') {
              spy.should.have.been.calledOnce;
              spy.should.have.been.calledWith(addArg);
            }
            wClose(watcher);
            done();
          });
      });
      it('should not choke on an ignored watch path', function(done) {
        options.ignored = function() { return true; };
        var watcher = stdWatcher().on('ready', function() {
          wClose(watcher);
          done();
        });
      });
      it('should ignore the contents of ignored dirs', function(done) {
        var spy = sinon.spy();
        var testDir = getFixturePath('subdir');
        var testFile = sysPath.join(testDir, 'add.txt');
        var ignoredArg = {type: 'addDir', path: testDir};
        var ignoredArg2 = {type: 'add', path: testFile};
        var ignoredArg3 = {type: 'change', path: testFile};
        options.ignored = testDir;
        fs.mkdirSync(testDir);
        fs.writeFileSync(testFile, 'b');
        var watcher = chokidar.watch(fixturesPath, options)
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(testFile, Date.now(), w(function() {
              spy.should.not.have.been.calledWith('addDir', ignoredArg);
              spy.should.not.have.been.calledWith('add', ignoredArg2);
              spy.should.not.have.been.calledWith('change', ignoredArg3);
              wClose(watcher);
              done();
            }));
          });
      });
      it('should allow regex/fn ignores', function(done) {
        options.cwd = fixturesPath;
        options.ignored = /add/;
        var spy = sinon.spy();
        var addPath = getFixturePath('add.txt');
        var changePath = getFixturePath('change.txt');
        var addArg = {type: 'add', path: changePath};
        var changeArg = {type: 'change', path: changePath};
        var ignoredArg = {type: 'add', path: addPath};
        var ignoredArg2 = {type: 'change', path: addPath};
        fs.writeFileSync(addPath, 'b');
        var watcher = chokidar.watch(fixturesPath, options)
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(addPath, Date.now(), simpleCb);
            fs.writeFile(changePath, Date.now(), simpleCb);
            waitFor([spy.withArgs('change', 'change.txt')], function() {
              spy.should.have.been.calledWith('add', addArg);
              spy.should.have.been.calledWith('change', changeArg);
              spy.should.not.have.been.calledWith('add', ignoredArg);
              spy.should.not.have.been.calledWith('change', ignoredArg2);
              wClose(watcher);
              done();
            });
          });
      });
    });
    describe('depth', function() {
      beforeEach(function(done) {
        var i = 0;
        var r = function() { i++ && w(done, options.useFsEvents && 200)(); };
        fs.mkdir(getFixturePath('subdir'), function() {
          fs.writeFile(getFixturePath('subdir/add.txt'), 'b', r);
          fs.mkdir(getFixturePath('subdir/subsub'), function() {
            fs.writeFile(getFixturePath('subdir/subsub/ab.txt'), 'b', r);
          });
        });
      });
      it('should not recurse if depth is 0', function(done) {
        options.depth = 0;
        var spy = sinon.spy();
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(getFixturePath('subdir/add.txt'), Date.now(), simpleCb);
            waitFor([[spy, 4]], function() {
              spy.should.have.been.calledWith('addDir', {type: 'addDir', path: fixturesPath});
              spy.should.have.been.calledWith('addDir', {type: 'addDir', path: getFixturePath('subdir')});
              spy.should.have.been.calledWith('add', {type: 'add', path: getFixturePath('change.txt')});
              spy.should.have.been.calledWith('add', {type: 'add', path: getFixturePath('unlink.txt')});
              spy.should.not.have.been.calledWith('change');
              if (!osXFsWatch) spy.callCount.should.equal(4);
              wClose(watcher);
              done();
            });
          });
      });
      it('should recurse to specified depth', function(done) {
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
          .on('ready', function() {
            fs.writeFile(changePath, Date.now(), simpleCb);
            fs.writeFile(addPath, Date.now(), simpleCb);
            fs.writeFile(ignoredPath, Date.now(), simpleCb);
            waitFor([
              spy.withArgs('change', addPath),
              spy.withArgs('change', changePath)
            ], function() {
              spy.should.have.been.calledWith('addDir', addDirArg);
              spy.should.have.been.calledWith('change', changeArg);
              spy.should.have.been.calledWith('change', addArg);
              spy.should.not.have.been.calledWith('add', ignoredArg);
              spy.should.not.have.been.calledWith('change', ignoredArg2);
              if (!osXFsWatch) spy.callCount.should.equal(8);
              wClose(watcher);
              done();
            });
          });
      });
      it('should respect depth setting when following symlinks', function(done) {
        if (os === 'win32') return done(); // skip on windows
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
      it('should respect depth setting when following a new symlink', function(done) {
        if (os === 'win32') return done(); // skip on windows
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
          .on('ready', function() {
            fs.symlink(getFixturePath('subdir'), linkPath, simpleCb);
            waitFor([
              [spy, 3],
              spy.withArgs('addDir', dirPath)
            ], function() {
              spy.should.have.been.calledWith('addDir', addDirArg);
              spy.should.have.been.calledWith('addDir', addDirArg2);
              spy.should.have.been.calledWith('add', addArg);
              if (!osXFsWatch) spy.should.have.been.calledThrice;
              wClose(watcher);
              done();
            });
          });
      });
      it('should correctly handle dir events when depth is 0', function(done) {
        options.depth = 0;
        var spy = sinon.spy();
        var addSpy = spy.withArgs('addDir');
        var unlinkSpy = spy.withArgs('unlinkDir');
        var subdirPath = getFixturePath('subdir');
        var subdirPath2 = getFixturePath('subdir2');
        var addDirArg = {type: 'addDir', path: fixturesPath};
        var addDirArg2 = {type: 'addDir', path: subdirPath};
        var unlinkDirArg = {type: 'unlinkDir', path: subdirPath2};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            spy.should.have.been.calledWith('addDir', addDirArg);
            spy.should.have.been.calledWith('addDir', addDirArg2);
            fs.mkdir(subdirPath2, simpleCb);
            waitFor([[addSpy, 3]], function() {
              addSpy.should.have.been.calledThrice;
              fs.rmdir(subdirPath2, simpleCb);
              waitFor([unlinkSpy], w(function() {
                unlinkSpy.should.have.been.calledWith('unlinkDir', unlinkDirArg);
                unlinkSpy.should.have.been.calledOnce;
                wClose(watcher);
                done();
              }));
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
      it('should ignore vim/emacs/Sublime swapfiles', function(done) {
        var spy = sinon.spy();
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(getFixturePath('.change.txt.swp'), 'a', simpleCb); // vim
            fs.writeFile(getFixturePath('add.txt~'), 'a', simpleCb); // vim/emacs
            fs.writeFile(getFixturePath('.subl5f4.tmp'), 'a', simpleCb); // sublime
            w(function() {
              fs.writeFile(getFixturePath('.change.txt.swp'), 'c', simpleCb);
              fs.writeFile(getFixturePath('add.txt~'), 'c', simpleCb);
              fs.writeFile(getFixturePath('.subl5f4.tmp'), 'c', simpleCb);
              w(function() {
                fs.unlink(getFixturePath('.change.txt.swp'), simpleCb);
                fs.unlink(getFixturePath('add.txt~'), simpleCb);
                fs.unlink(getFixturePath('.subl5f4.tmp'), simpleCb);
                w(function() {
                  spy.should.not.have.been.called;
                  wClose(watcher);
                  done();
                }, 300)();
              }, 300)();
            }, 300)();
          });
      });
    });
    describe('ignoreTmpFiles', function() {
      beforeEach(function() {
        options.atomic = false;
        options.ignoreTmpFiles = true;
        options.ignoreInitial = true;
      });
      it('should ignore vim/emacs/Sublime swapfiles', function(done) {
        var spy = sinon.spy();
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(getFixturePath('.change.txt.swp'), 'a', simpleCb); // vim
            fs.writeFile(getFixturePath('add.txt~'), 'a', simpleCb); // vim/emacs
            fs.writeFile(getFixturePath('.subl5f4.tmp'), 'a', simpleCb); // sublime
            w(function() {
              fs.writeFile(getFixturePath('.change.txt.swp'), 'c', simpleCb);
              fs.writeFile(getFixturePath('add.txt~'), 'c', simpleCb);
              fs.writeFile(getFixturePath('.subl5f4.tmp'), 'c', simpleCb);
              w(function() {
                fs.unlink(getFixturePath('.change.txt.swp'), simpleCb);
                fs.unlink(getFixturePath('add.txt~'), simpleCb);
                fs.unlink(getFixturePath('.subl5f4.tmp'), simpleCb);
                w(function() {
                  spy.should.not.have.been.called;
                  wClose(watcher);
                  done();
                })();
              })();
            })();
          });
      });
    });
    describe('cwd', function() {
      it('should emit relative paths based on cwd', function(done) {
        options.cwd = fixturesPath;
        var spy = sinon.spy();
        var changePath = getFixturePath('change.txt');
        var unlinkPath = getFixturePath('unlink.txt');
        var addArg = {type: 'add', path: changePath};
        var addArg2 = {type: 'add', path: unlinkPath};
        var changeArg = {type: 'change', path: changePath};
        var unlinkArg = {type: 'unlink', path: unlinkPath};
        var watcher = chokidar.watch('**', options)
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(getFixturePath('change.txt'), Date.now(), function() {
              fs.unlink(getFixturePath('unlink.txt'), simpleCb);
            });
            waitFor([spy.withArgs('unlink')], function() {
              spy.should.have.been.calledWith('add', addArg);
              spy.should.have.been.calledWith('add', addArg2);
              spy.should.have.been.calledWith('change', changeArg);
              if (!osXFsWatch && os === 'darwin') spy.should.have.been.calledWith('unlink', unlinkArg);
              wClose(watcher);
              done();
            });
          });
      });
      it('should emit `addDir` with alwaysStat for renamed directory', function(done) {
        options.cwd = fixturesPath;
        options.alwaysStat = true;
        options.ignoreInitial = true;
        var spy = sinon.spy();
        var testDir = getFixturePath('subdir');
        var renamedDir = getFixturePath('subdir-renamed');
        var addDirArg = {type: 'addDir', path: renamedDir};
        fs.mkdir(testDir, simpleCb);
        var watcher = chokidar.watch('.', options)
          .on('ready', function() {
            w(function() {
              watcher.on('addDir', spy);
              fs.rename(testDir, renamedDir, simpleCb);
            }, 1000)();
            waitFor([spy], function() {
              spy.should.have.been.calledOnce;
              spy.should.have.been.calledWith(addDirArg);
              expect(spy.args[0][1]).to.be.ok; // stats
              wClose(watcher);
              done();
            });
          });
      });
      it('should allow separate watchers to have different cwds', function(done) {
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
          .on('ready', function() {
            w(fs.writeFile.bind(fs, testPath, Date.now(), simpleCb))();
            var watcher2 = chokidar.watch('**', options2)
              .on('all', spy2)
              .on('ready', function() {
                w(fs.writeFile.bind(fs, testPath2, Date.now(), simpleCb))();
                waitFor([spy, spy2], function() {
                  spy.should.have.been.calledWith('add', testArg);
                  spy2.should.have.been.calledWith('add', testArg2);
                  wClose(watcher2);
                  wClose(watcher);
                  done();
                });
              });
          });
      });
      it('should ignore files even with cwd', function(done) {
        options.cwd = fixturesPath;
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
          .on('ready', function() {
            fs.writeFileSync(ignoredPath, Date.now());
            fs.writeFileSync(ignoredPath2, Date.now());
            fs.unlink(ignoredPath, simpleCb);
            fs.unlink(ignoredPath2, simpleCb);
            w(fs.writeFile.bind(fs, changePath, 'change', simpleCb))();
            waitFor([spy.withArgs('change', 'change.txt')], function() {
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
            });
          });
      });
    });
    describe('ignorePermissionErrors', function() {
      var filePath;
      beforeEach(function(done) {
        filePath = getFixturePath('add.txt');
        fs.writeFile(filePath, 'b', {mode: 128}, w(done));
      });
      describe('false', function() {
        beforeEach(function() { options.ignorePermissionErrors = false; });
        it('should not watch files without read permissions', function(done) {
          if (os === 'win32') return done();
          var spy = sinon.spy();
          var watcher = stdWatcher()
            .on('all', spy)
            .on('ready', function() {
              spy.should.not.have.been.calledWith('add', {type: 'add', path: filePath});
              fs.writeFile(filePath, Date.now(), function() {
                spy.should.not.have.been.calledWith('change', {type: 'change', path: filePath});
                wClose(watcher);
                done();
              });
            });
        });
      });
      describe('true', function() {
        beforeEach(function() { options.ignorePermissionErrors = true; });
        it('should watch unreadable files if possible', function(done) {
          var spy = sinon.spy();
          var watcher = stdWatcher()
            .on('all', spy)
            .on('ready', function() {
              spy.should.have.been.calledWith('add', {type: 'add', path: filePath});
              if (!options.useFsEvents) return done();
              fs.writeFile(filePath, Date.now(), simpleCb);
              waitFor([spy.withArgs('change')], function() {
                spy.should.have.been.calledWith('change', {type: 'change', path: filePath});
                wClose(watcher);
                done();
              });
            });
        });
        it('should not choke on non-existent files', function(done) {
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
      it('should use default options if none given', function() {
        options.awaitWriteFinish = true;
        var watcher = stdWatcher();
        expect(watcher.options.awaitWriteFinish.pollInterval).to.equal(100);
        expect(watcher.options.awaitWriteFinish.stabilityThreshold).to.equal(2000);
        wClose(watcher);
      });
      it('should not emit add event before a file is fully written', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('add.txt');
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(testPath, 'hello', simpleCb);
            w(function() {
              spy.should.not.have.been.calledWith('add');
              wClose(watcher);
              done();
            }, 300)();
          });
      });
      it('should wait for the file to be fully written before emitting the add event', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('add.txt');
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(testPath, 'hello', w(function() {
              spy.should.not.have.been.called;
            }, 300));
            waitFor([spy], function() {
              spy.should.have.been.calledWith('add', {type: 'add', path: testPath});
              wClose(watcher);
              done();
            });
          });
      });
      it('should emit with the final stats', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('add.txt');
        var testArg = {type: 'change', path: testPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(testPath, 'hello ', w(function() {
              fs.appendFile(testPath, 'world!', simpleCb);
            }, 300));
            waitFor([spy], function() {
              spy.should.have.been.calledWith('add', testArg);
              expect(spy.args[0][2].size).to.equal(12);
              wClose(watcher);
              done();
            });
          });
      });
      it('should not emit change event while a file has not been fully written', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('add.txt');
        var testArg = {type: 'change', path: testPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(testPath, 'hello', simpleCb);
            w(function() {
              fs.writeFile(testPath, 'edit', simpleCb);
              w(function() {
                spy.should.not.have.been.calledWith('change', testArg);
                wClose(watcher);
                done();
              }, 200)();
            }, 100)();
          });
      });
      it('should not emit change event before an existing file is fully updated', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('change.txt');
        var testArg = {type: 'change', path: testPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(testPath, 'hello', simpleCb);
            w(function() {
              spy.should.not.have.been.calledWith('change', testArg);
              wClose(watcher);
              done();
            }, 300)();
          });
      });
      it('should wait for an existing file to be fully updated before emitting the change event', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('change.txt');
        var testArg = {type: 'change', path: testPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(testPath, 'hello', w(function() {
              spy.should.not.have.been.called;
            }, 300));
            waitFor([spy], function() {
              spy.should.have.been.calledWith('change', testArg);
              wClose(watcher);
              done();
            });
          });
      });
      it('should emit change event after the file is fully written', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('add.txt');
        var testArg = {type: 'add', path: testPath};
        var testArg2 = {type: 'change', path: testPath};
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            w(fs.writeFile.bind(fs, testPath, 'hello', simpleCb))();
            waitFor([spy], function() {
              spy.should.have.been.calledWith('add', testArg);
              fs.writeFile(testPath, 'edit', simpleCb);
              waitFor([spy.withArgs('change')], function() {
                spy.should.have.been.calledWith('change', testArg2);
                wClose(watcher);
                done();
              });
            });
          });
      });
      it('should be compatible with the cwd option', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('subdir/add.txt');
        var testArg = {type: 'add', path: testPath};
        options.cwd = sysPath.dirname(testPath);
        fs.mkdirSync(options.cwd);
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            w(fs.writeFile.bind(fs, testPath, 'hello', simpleCb), 400)();
            waitFor([spy.withArgs('add')], function() {
              spy.should.have.been.calledWith('add', testArg);
              wClose(watcher);
              done();
            });
          });
      });
      it('should still emit initial add events', function(done) {
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
      it('should emit an unlink event when a file is updated and deleted just after that', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('subdir/add.txt');
        var unlinkArg = {type: 'unlink', path: testPath};
        var ignoredArg = {type: 'change', path: testPath};
        options.cwd = sysPath.dirname(testPath);
        fs.mkdirSync(options.cwd);
        fs.writeFileSync(testPath, 'hello');
        var watcher = stdWatcher()
          .on('all', spy)
          .on('ready', function() {
            fs.writeFile(testPath, 'edit', w(function() {
              fs.unlink(testPath, simpleCb);
              waitFor([spy.withArgs('unlink')], function() {
                if (!osXFsWatch && os === 'darwin') spy.should.have.been.calledWith('unlink', unlinkArg);
                spy.should.not.have.been.calledWith('change', ignoredArg);
                wClose(watcher);
                done();
              });
            }));
          });
      });
    });
  });
  describe('getWatched', function() {
    it('should return the watched paths', function(done) {
      var expected = {};
      expected[sysPath.dirname(fixturesPath)] = [subdir.toString()];
      expected[fixturesPath] = ['change.txt', 'unlink.txt'];
      var watcher = stdWatcher()
        .on('ready', function() {
          expect(watcher.getWatched()).to.deep.equal(expected);
          wClose(watcher);
          done();
        });
    });
    it('should set keys relative to cwd & include added paths', function(done) {
      options.cwd = fixturesPath;
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
    beforeEach(function(done) {
      options.ignoreInitial = true;
      fs.mkdir(getFixturePath('subdir'), w(done));
    });
    it('should stop watching unwatched paths', function(done) {
      var spy = sinon.spy();
      var subdirPath = getFixturePath('subdir');
      var addPath = sysPath.join(subdirPath, 'add.txt');
      var changePath = getFixturePath('change.txt');
      var testArg = {type: 'change', path: changePath};
      var watchPaths = [subdirPath, changePath];
      var watcher = chokidar.watch(watchPaths, options)
        .on('all', spy)
        .on('ready', function() {
          watcher.unwatch(subdirPath);
          w(function() {
            fs.writeFile(addPath, Date.now(), simpleCb);
            fs.writeFile(changePath, Date.now(), simpleCb);
          })();
          waitFor([spy], w(function() {
            spy.should.have.been.calledWith('change', testArg);
            spy.should.not.have.been.calledWith('add');
            if (!osXFsWatch) spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          }, 300));
        });
    });
    it('should ignore unwatched paths that are a subset of watched paths', function(done) {
      var spy = sinon.spy();
      var subdirPath = getFixturePath('subdir');
      var addPath = sysPath.join(subdirPath, 'add.txt');
      var changePath = getFixturePath('change.txt');
      var unlinkPath = getFixturePath('unlink.txt');
      var watcher = chokidar.watch(fixturesPath, options)
        .on('all', spy)
        .on('ready', w(function() {
          // test with both relative and absolute paths
          var subdirRel = sysPath.relative(process.cwd(), subdirPath);
          watcher.unwatch([subdirRel, getFixturePath('unl*')]);
          w(function() {
            fs.unlink(unlinkPath, simpleCb);
            fs.writeFile(addPath, Date.now(), simpleCb);
            fs.writeFile(changePath, Date.now(), simpleCb);
          })();
          waitFor([spy.withArgs('change')], w(function() {
            spy.should.have.been.calledWith('change', {type: 'change', path: changePath});
            spy.should.not.have.been.calledWith('add', addPath);
            spy.should.not.have.been.calledWith('unlink');
            wClose(watcher);
            done();
          }, 300));
        }));
    });
    it('should unwatch relative paths', function(done) {
      var spy = sinon.spy();
      var fixturesDir = sysPath.relative(process.cwd(), fixturesPath);
      var subdir = sysPath.join(fixturesDir, 'subdir');
      var changeFile = sysPath.join(fixturesDir, 'change.txt');
      var testArg = {type: 'change', path: changeFile};
      var watchPaths = [subdir, changeFile];
      var watcher = chokidar.watch(watchPaths, options)
        .on('all', spy)
        .on('ready', function() {
          watcher.unwatch(subdir);
          w(function() {
            fs.writeFile(getFixturePath('subdir/add.txt'), Date.now(), simpleCb);
            fs.writeFile(getFixturePath('change.txt'), Date.now(), simpleCb);
          }, 300)();
          waitFor([spy], function() {
            spy.should.have.been.calledWith('change', testArg);
            spy.should.not.have.been.calledWith('add');
            if (!osXFsWatch) spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          });
        });
    });
    it('should watch paths that were unwatched and added again', function(done) {
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
              fs.writeFile(changePath, Date.now(), simpleCb);
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
    it('should unwatch paths that are relative to options.cwd', function(done) {
      options.cwd = fixturesPath;
      var spy = sinon.spy();
      var addPath = getFixturePath('subdir/add.txt');
      var changePath = getFixturePath('change.txt');
      var unlinkPath = getFixturePath('unlink.txt');
      var testArg = {type: 'change', path: changePath};
      var watcher = chokidar.watch('.', options)
        .on('all', spy)
        .on('ready', function() {
          watcher.unwatch(['subdir', unlinkPath]);
          w(function() {
            fs.unlink(unlinkPath, simpleCb);
            fs.writeFile(addPath, Date.now(), simpleCb);
            fs.writeFile(changePath, Date.now(), simpleCb);
          })();
          waitFor([spy], w(function() {
            spy.should.have.been.calledWith('change', testArg);
            spy.should.not.have.been.calledWith('add');
            spy.should.not.have.been.calledWith('unlink');
            if (!osXFsWatch) spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          }, 300));
        });
    });
  });
  describe('close', function() {
    it('should ignore further events on close', function(done) {
      var spy = sinon.spy();
      var watcher = chokidar.watch(fixturesPath, options)
        .once('add', function() {
          watcher.once('add', function() {
            watcher.on('add', spy).close();
            fs.writeFile(getFixturePath('add.txt'), Date.now(), simpleCb);
            w(function() {
              spy.should.not.have.been.called;
              wClose(watcher);
              done();
            }, 900)();
          });
        })
        .on('ready', function() {
          fs.writeFile(getFixturePath('add.txt'), 'hello', function() {
            fs.unlink(getFixturePath('add.txt'), simpleCb);
          });
        });
    });
    it('should not prevent the process from exiting', function(done) {
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

      it('should make options.usePolling `true` when CHOKIDAR_USEPOLLING is set to true', function(done) {
        options.usePolling = false;
        process.env.CHOKIDAR_USEPOLLING = true;

        var watcher = chokidar.watch(fixturesPath, options)
          .on('ready', function() {
            watcher.options.usePolling.should.be.true;
            wClose(watcher);
            done();
          });
      });

      it('should make options.usePolling `true` when CHOKIDAR_USEPOLLING is set to 1', function(done) {
        options.usePolling = false;
        process.env.CHOKIDAR_USEPOLLING = 1;

        var watcher = chokidar.watch(fixturesPath, options)
          .on('ready', function() {
            watcher.options.usePolling.should.be.true;
            wClose(watcher);
            done();
          });
      });

      it('should make options.usePolling `false` when CHOKIDAR_USEPOLLING is set to false', function(done) {
        options.usePolling = true;
        process.env.CHOKIDAR_USEPOLLING = false;

        var watcher = chokidar.watch(fixturesPath, options)
          .on('ready', function() {
            watcher.options.usePolling.should.be.false;
            wClose(watcher);
            done();
          });
      });

      it('should make options.usePolling `false` when CHOKIDAR_USEPOLLING is set to 0', function(done) {
        options.usePolling = true;
        process.env.CHOKIDAR_USEPOLLING = false;

        var watcher = chokidar.watch(fixturesPath, options)
          .on('ready', function() {
            watcher.options.usePolling.should.be.false;
            wClose(watcher);
            done();
          });
      });

      it('should not attenuate options.usePolling when CHOKIDAR_USEPOLLING is set to an arbitrary value\
', function(done) {
        options.usePolling = true;
        process.env.CHOKIDAR_USEPOLLING = 'foo';

        var watcher = chokidar.watch(fixturesPath, options)
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

      it('should make options.interval = CHOKIDAR_INTERVAL when it is set', function(done) {
        options.interval = 100;
        process.env.CHOKIDAR_INTERVAL = 1500;

        var watcher = chokidar.watch(fixturesPath, options)
          .on('ready', function() {
            watcher.options.interval.should.be.equal(1500);
            wClose(watcher);
            done();
          });
      });
    });
  });
}
