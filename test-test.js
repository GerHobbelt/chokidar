'use strict';

var chokidar = require('./');
var chai = require('chai');
var expect = chai.expect;
var should = chai.should();
var sinon = require('sinon');
var rimraf = require('rimraf');
var fs = require('graceful-fs');
var sysPath = require('path');
var cp = require('child_process');
chai.use(require('sinon-chai'));
var os = process.platform;

function getFixturePath (subPath) {
  return sysPath.join(
    __dirname,
    'test-fixtures',
    subdir && subdir.toString() || '',
    subPath
  );
}

var fixturesPath = getFixturePath(''),
    mochaIt = it,
    options,
    osXFsWatch,
    slowerDelay,
    subdir = 0,
    testCount = 0,
    win32Polling;

if (!fs.readFileSync(__filename).toString().match(/\sit\.only\(/)) {
  it = function() {
    testCount++;
    mochaIt.apply(this, arguments);
  }
  it.skip = function() {
    testCount--;
    mochaIt.skip.apply(this, arguments)
  }
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
    fs.mkdir(fixturesPath, 0x1ed, function(err) {
      if (err) throw err;
      while (subdir < testCount) {
        subdir++;
        fixturesPath = getFixturePath('');
        fs.mkdir(fixturesPath, 0x1ed, function() {
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

  if (os === 'darwin') {
    describe('fsevents (native extension)', runTests.bind(this, {useFsEvents: true}));
  }
//  describe('fs.watch (non-polling)', runTests.bind(this, {usePolling: false, useFsEvents: false}));
//  describe('fs.watchFile (polling)', runTests.bind(this, {usePolling: true, interval: 10}));
});

function simpleCb(err) { if (err) throw err; }
function w(fn, to) {
  return setTimeout.bind(null, fn, to || slowerDelay || 50);
}

function runTests(baseopts) {
  baseopts.persistent = true;

  before(function() {
    // flags for bypassing special-case test failures on CI
    osXFsWatch = os === 'darwin' && !baseopts.usePolling && !baseopts.useFsEvents;
    win32Polling = os === 'win32' && baseopts.usePolling;

    if (osXFsWatch) {
      slowerDelay = 200;
    } else {
      slowerDelay = undefined;
    }
  });

  beforeEach(function clean() {
    options = {};
    Object.keys(baseopts).forEach(function(key) {
      options[key] = baseopts[key]
    });
  });

  function stdWatcher() {
    return chokidar.watch(fixturesPath, options);
  }

  function waitFor(spies, fn) {
    function isSpyReady(spy) {
      return Array.isArray(spy) ? spy[0].callCount >= spy[1] : spy.callCount;
    }
    function finish() {
      clearInterval(intrvl);
      clearTimeout(to);
      fn();
      fn = Function.prototype;
    }
    var intrvl = setInterval(function() {
      if (spies.every(isSpyReady)) finish();
    }, 5);
    var to = setTimeout(finish, 3500);
  }

  function wClose(watcher) {
    if (!baseopts.useFsEvents) {
      watcher.close();
    }
  }

  describe('watch options', function() {
    describe('awaitWriteFinish', function() {
      beforeEach(function() {
        options.awaitWriteFinish = {stabilityThreshold: 500}; options.ignoreInitial = true;
      });
      it('should emit an unlink event when a file is updated and deleted just after that', function(done) {
        var spy = sinon.spy();
        var testPath = getFixturePath('subdir/add.txt');
        var unlinkArg = {type: 'unlink', path: testPath};
        var ignoredArg = {type: 'change', path: testPath};
        options.cwd = sysPath.dirname(testPath);
        fs.mkdir(options.cwd, w(function() {
          fs.writeFile(testPath, 'hello', w(function() {
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
          }));
        }));
      });
    });
  });
  describe('unwatch', function() {
    beforeEach(function(done) {
      options.ignoreInitial = true;
      fs.mkdir(getFixturePath('subdir'), 0x1ed, w(done));
    });
    it('should stop watching unwatched paths', function(done) {
      var spy = sinon.spy();
      var subdirPath = getFixturePath('subdir');
      var addPath = sysPath.join(subdirPath, 'add.txt');
      var changePath = getFixturePath('change.txt')
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
        .on('ready', w(function() {
          watcher.unwatch(subdir);
          fs.writeFile(getFixturePath('subdir/add.txt'), Date.now(), simpleCb);
          fs.writeFile(getFixturePath('change.txt'), Date.now(), simpleCb);
          waitFor([spy], w(function() {
            spy.should.have.been.calledWith('change', testArg);
            spy.should.not.have.been.calledWith('add');
            if (!osXFsWatch) spy.should.have.been.calledOnce;
            wClose(watcher);
            done();
          }, 300));
        }));
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
}
