    var fs      = require('fs-ext');
    var path    = require('path');
    var util    = require('util');
    var url     = require('url');
    var http    = require('http');
    var crypto  = require('crypto');
    var async   = require('async');
    var exec    = require('child_process').exec;
    var syslog  = require('syslog-console').init('FSExtended');
    var oConfig = {
        FEATURES: {
            FLOCK: false
        }
    };

    if (fs.existsSync('/etc/cameo/.config.js')) {
        oConfig = require('/etc/cameo/.config.js');
    }

    http.globalAgent.maxSockets = 10000;

    var TEMP_CREATED = false;

    exports.clearTmp = function(fCallback) {
        var sTmp = exports.getTmpSync();
        exports.removeDirectory(sTmp, function() {
            exports.mkdirP(sTmp, 0777, function(oError) {
                if (oError) {
                    if (oError.code == 'EEXIST') {
                        syslog.warning({action: 'fs-extended:clearTmp', error: oError});
                    } else {
                        syslog.error({action: 'fs-extended:clearTmp', error: oError});
                        process.exit(1);
                    }
                }

                TEMP_CREATED = true;
                fCallback();
            });
        });
    };

    exports.clearTmpIfWeHaventAlready = function(fCallback) {
        if (!TEMP_CREATED) {
            exports.clearTmp(fCallback);
        } else {
            fCallback();
        }
    };

    exports.getTmp = function(fCallback) {
        fCallback(exports.getTmpSync());
    };

    exports.getTmpSync = function() {
        return '/tmp/cameo/' + process.pid + '/';
    };

    exports.hasTmp = function() {
        return TEMP_CREATED;
    };

    exports.killTmp = function(fCallback) {
        exports.removeDirectory(exports.getTmpSync(), fCallback);
    };

    exports.removeDirectories = function(aPaths, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        var remove = function() {
            if (aPaths.length == 0) {
                fCallback();
            } else {
                exports.removeDirectory(aPaths.shift(), remove);
            }
        };

        remove();
    };

    exports.removeDirectory = function(sPath, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        fs.stat(sPath, function(oError, oStat) {
            if (oStat !== undefined) {
                // syslog.debug({action: 'fs-extended:removeDirectory', path: sPath, stack: new Error().stack });
                if (oStat.isDirectory()) {
                    exec('rm -rf ' + sPath, function() {
                        fCallback(sPath);
                    });
                } else {
                    fs.unlink(sPath, function() {
                        fCallback(sPath);
                    });
                }
            } else {
                fCallback(sPath);
            }
        });
    };

    exports.copyDirectoryPropertiesToFile = function(sFile, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        var sPath = path.dirname(sFile);
        fs.stat(sPath, function(oError, oStat) {
            if (oError) {
                console.error('Error', oError);
            } else {
                fs.chmod(sFile, oStat.mode, function() {                                        // Copy Permissions from Parent Directory
                    fs.chown(sFile, oStat.gid, oStat.uid, function() {                          // Copy Ownership from Parent Directory
                        fCallback(sFile);
                    });
                });
            }
        });
    };

    exports._openLockFile = function(sFile, fCallback) {
        fs.open(sFile, 'r', function(oError, iFileHandle) {
            if (oError) {
                fs.open(sFile, 'w+', fCallback);
            } else {
                fCallback(null, iFileHandle);
            }
        })
    };

    exports.locks = {};
    exports.LOCK_TYPES = {
        READ:  'sh',
        WRITE: 'ex'
    };

    exports._addLock  = function(sFile, iHandle) {
        if (exports.locks[sFile] === undefined) {
            exports.locks[sFile] = [];
        }

        exports.locks[sFile].push(iHandle);
    };

    exports._getLock  = function(sFile) {
        if (exports.locks[sFile] === undefined) {
            exports.locks[sFile] = [];
        }

        return exports.locks[sFile][exports.locks[sFile].length - 1];
    };

    exports._popLock  = function(sFile) {
        if (exports.locks[sFile] === undefined) {
            exports.locks[sFile] = [];
        }

        return exports.locks[sFile].pop()
    };

    exports.lock  = function(sFile, oOptions, fCallback) {
        if (!exports._canLock()) {
            syslog.debug({action: 'fs-extended.lock.disabled', file: sFile, options: oOptions});
            return fCallback();
        }

        sFile = path.resolve(sFile);
        sFile = sFile.replace(/^\/?var\/lock\//, '');
        sFile = sFile.replace(/^\//, '');
        sFile = '/var/lock/' + sFile;

        oOptions.lock    = oOptions.lock !== undefined ? oOptions.lock    : exports.LOCK_TYPES.WRITE;
        oOptions.retries = oOptions.lock !== undefined ? oOptions.retries : 0;
        oOptions.wait    = oOptions.lock !== undefined ? oOptions.wait    : 0;

        syslog.debug({action: 'fs-extended.lock', file: sFile, options: oOptions});
        exports.mkdirP(path.dirname(sFile), 0777, function(oError) { // mocking path the file being locked in /var/lock
            fs.open(sFile, 'w+', function(oOpenError, iFileHandle) { // creating empty writable file on which we'll run flock
                if (oOpenError) {
                    syslog.error({action: 'fs-extended.lock.open.error', file: sFile, options: oOptions, error: oOpenError});
                    fCallback(oOpenError);
                } else {
                    fs.flock(iFileHandle, oOptions.lock + 'nb', function(oLockError) { // generate a non-blocking lock on the file to allow javascript to handle the retry
                        if (!oLockError) {
                            syslog.debug({action: 'fs-extended.lock.locked', file: sFile, options: oOptions, handle: iFileHandle});
                            exports._addLock(sFile, iFileHandle);
                            fCallback()
                        } else if (oOptions.retries > 0) {
                            syslog.warn({action: 'fs-extended.lock.retry', file: sFile, options: oOptions});
                            oOptions.retries -= 1;

                            setTimeout(function() {
                                exports.lock(sFile, oOptions, fCallback);
                            }, oOptions.wait);
                        } else {
                            syslog.error({action: 'fs-extended.lock.error', file: sFile, options: oOptions, error: oLockError});
                            fCallback(oLockError);
                        }
                    });
                }
            });
        });
    };

    exports._canLock = function() {
        return oConfig.FEATURES.FLOCK
            && process.platform == 'linux';
    };

    exports.readLock  = function(sFile, oOptions, fCallback) {
        oOptions.lock = exports.LOCK_TYPES.READ;
        exports.lock(sFile, oOptions, fCallback);
    };

    exports.writeLock  = function(sFile, oOptions, fCallback) {
        oOptions.lock = exports.LOCK_TYPES.WRITE;
        exports.lock(sFile, oOptions, fCallback);
    };

    exports.unlock = function(sFile, fCallback) {
        if (!exports._canLock()) {
            syslog.debug({action: 'fs-extended.unlock.disabled', file: sFile});
            return fCallback();
        }

        if (sFile === undefined) {
            return fCallback(new Error('No File Given'));
        }

        sFile = path.resolve(sFile);
        sFile = sFile.replace(/^\/?var\/lock\//, '');
        sFile = sFile.replace(/^\//, '');
        sFile = '/var/lock/' + sFile;

        syslog.debug({action: 'fs-extended.unlock', file: sFile});
        var iFileHandle = exports._getLock(sFile);
        if (iFileHandle) { // lock was created by this process, so just delete the in-memory lock and close the file
            syslog.debug({action: 'fs-extended.unlock.unlocked', file: sFile, handle: iFileHandle});
            exports._popLock(sFile);
            fs.close(iFileHandle, fCallback);
        } else {
            fs.open(sFile, 'r+', function(oOpenError, iFileHandle) {
                if (oOpenError) {
                    syslog.debug({action: 'fs-extended.unlock.missing', file: sFile});
                    fCallback(null); // lock file does not exist - consider it unlocked
                } else {
                    syslog.debug({action: 'fs-extended.unlock.unlocked', file: sFile, handle: iFileHandle});
                    fs.flock(iFileHandle, 'un', fCallback);
                }
            });
        }
    };

    exports.copyFile = function(sFromFile, sToFile, fCallback) {
        syslog.debug({action: 'fs-extended.copyFile', input: sFromFile, output: sToFile});

        async.auto({
            lockRead:  function(fAsyncCallback, oResults) { exports.readLock(sFromFile, {retries: 300, wait: 100},  fAsyncCallback)},
            lockWrite: function(fAsyncCallback, oResults) { exports.writeLock(sToFile,  {retries: 300, wait: 100}, fAsyncCallback)},
            copy:      ['lockRead', 'lockWrite', function(fAsyncCallback, oResults) {
                // CANNOT use fs.rename due to partition limitations
                var oReader = fs.createReadStream(sFromFile);
                var oWriter = fs.createWriteStream(sToFile);

                var bCallbackCalled = false;

                oWriter.on('close', function() {
                    fAsyncCallback(null, sToFile);
                });

                oReader.on('error', function(oError) {
                    syslog.error({action: 'fs-extended.copyFile.reader.error', input: sFromFile, output: sToFile, error: oError});
                    fAsyncCallback(oError);
                });

                oWriter.on('error', function(oError) {
                    syslog.error({action: 'fs-extended.copyFile.writer.error', input: sFromFile, output: sToFile, error: oError});
                    fAsyncCallback(oError);
                });

                oReader.pipe(oWriter);
            }]
        }, function(oError, oResults) {
            async.each([sFromFile, sToFile], exports.unlock, function() {
                if (oError) {
                    syslog.error({action: 'fs-extended.copyFile.error', input: sFromFile, output: sToFile, error: oError});
                    fCallback(oError);
                } else {
                    syslog.debug({action: 'fs-extended.copyFile.done', input: sFromFile, output: sToFile});
                    fCallback(null, oResults.copy);
                }
            });
        });
    };

    /**
     *
     * @param {String} sPath
     * @param {Function} fCallback oError, oFiles[sFilename] = {hash: sHash, path: sFilePath, file: sFile}
     */
    exports.moveDirectoryFilesToHashes = function(sPath, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};


        exports.hashDirectoryFiles(sPath, function(oError, oFiles) {
            var aFiles    = [];
            var oResponse = {};
            for (var sFile in oFiles) {
                var oFile = {
                    hash: oFiles[sFile],
                    path: path.dirname(sFile),
                    file: path.basename(sFile)
                };

                oResponse[sFile] = oFile;
                aFiles.push(oFile);
            }

            async.forEach(aFiles, function(oFile, fAsyncCallback) {
                exports.moveFile(path.join(oFile.path, oFile.file), path.join(oFile.path, oFile.hash), fAsyncCallback);
            }, function(oError) {
                if (oError) {
                    fCallback(oError);
                } else {
                    fCallback(null, oResponse);
                }
            });
        });
    };

    /**
     *
     * @param {String} sFromFile
     * @param {String} sPath
     * @param {String} [sExtension]
     * @param {Function} fCallback
     */
    exports.copyFileToHash = function(sFromFile, sPath, sExtension, fCallback) {
        if (typeof sExtension == 'function') {
            fCallback  = sExtension;
            sExtension = '';
        }

        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        var sTimer = syslog.timeStart('fs-extended.copyFileToHash');

        exports.hashFile(sFromFile, function(oError, sHash) {
            if (oError) {
                syslog.error({action: 'fs-extended.copyFileToHash.hashFile.error', input: sFromFile, error: oError});
                fCallback(oError);
            } else {
                var sDestination = path.join(sPath, sHash) + sExtension;
                exports.copyFile(sFromFile, sDestination, function(oCopyError, sDestination) {
                    if (oCopyError) {
                        syslog.error({action: 'fs-extended.copyFileToHash.copyFile.error', input: sFromFile, error: oCopyError});
                        fCallback(oCopyError);
                    } else {
                        var oOutput = {
                            path: sDestination,
                            hash: sHash
                        };

                        syslog.timeStop(sTimer, {input: sFromFile, output: oOutput});
                        fCallback(null, oOutput);
                    }
                });
            }
        });
    };

    /**
     *
     * @param sFromFile
     * @param sPath
     * @param fCallback
     */
    exports.moveFileToHash = function(sFromFile, sPath, fCallback) {
        exports.moveFileToHashWithExtension(sFromFile, sPath, '', fCallback);
    };

    /**
     *
     * @param {String} sFromFile
     * @param {String} sPath
     * @param {String} sExtension
     * @param {Function} fCallback
     */
    exports.moveFileToHashWithExtension = function(sFromFile, sPath, sExtension, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        var sTimer = syslog.timeStart('fs-extended.moveFileToHash');

        exports.hashFile(sFromFile, function(oError, sHash) {
            if (oError) {
                syslog.error({action: 'fs-extended.moveFileToHash.hashFile.error', input: sFromFile, error: oError});
                fCallback(oError);
            } else {
                var sDestination = path.join(sPath, sHash) + sExtension;
                exports.moveFile(sFromFile, sDestination, function(oMoveError, sDestination) {
                    if (oMoveError) {
                        syslog.error({action: 'fs-extended.moveFileToHash.moveFile.error', input: sFromFile, error: oMoveError});
                        fCallback(oMoveError);
                    } else {
                        var oOutput = {
                            path: sDestination,
                            hash: sHash
                        };

                        syslog.timeStop(sTimer, {input: sFromFile, output: oOutput});
                        fCallback(null, oOutput);
                    }
                });
            }
        });
    };

    exports.moveFile = function(sFromFile, sToFile, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        if (sFromFile != sToFile) {
            var sTimer = syslog.timeStart('fs-extended.moveFile');
            exports.copyFile(sFromFile, sToFile, function(oCopyError) {
                if (oCopyError) {
                    syslog.error({action: 'fs-extended.moveFile.copy', input: sFromFile, error: oCopyError});
                }

                fs.unlink(sFromFile, function(oUnlinkError) {
                    if (oUnlinkError) {
                        syslog.error({action: 'fs-extended.moveFile.unlink', input: sFromFile, error: oUnlinkError});
                    }

                    syslog.timeStop(sTimer, {input: sFromFile, output: sToFile});
                    fCallback(null, sToFile);
                });
            });
        } else {
            fCallback(null, sToFile);
        }
    };

    exports.directorySize = function(sPath, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        exec('du -s ' + sPath, function(oError, sSTDOut, sSTDError) {
            if (oError) {
                fCallback(oError);
            } else {
                var aDU = sSTDOut.replace(/^\s+|\s+$/g, '').split('\t');
                fCallback(null, aDU[0]);
            }
        });
    };

    exports.md5FileToBase64 = function(sFile, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        //syslog.debug({action: 'fs-extended.md5FileToBase64', input: sFile});
        exec('openssl dgst -md5 -binary ' + sFile + ' | openssl enc -base64', function(oError, sSTDOut, sSTDError) {
            if (oError) {
                fCallback(oError);
            } else {
                var aHash = sSTDOut.replace(/^\s+|\s+$/g, '').split(' ');
                var sHash = aHash[0];

                syslog.debug({action: 'fs-extended.md5FileToBase64.done', output: sHash});
                fCallback(null, sHash);
            }
        });
    };

    exports.hashFile = function(sFile, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        async.auto({
            lock:           function(fAsyncCallback, oResults) { exports.readLock(sFile, {retries: 300, wait: 100}, fAsyncCallback)},
            hash:  ['lock', function(fAsyncCallback, oResults) {
                exec('sha1sum ' + sFile, function(oError, sSTDOut, sSTDError) {
                    if (oError) {
                        syslog.error({action: 'fs-extended.hashFile.error', error: oError, stdErr: sSTDError});
                        fCallback(oError);
                    } else {
                        var aHash = sSTDOut.replace(/^\s+|\s+$/g, '').split(' ');
                        var sHash = aHash[0];

                        //syslog.timeStop(sTimer, {output: sHash});
                        fAsyncCallback(null, sHash);
                    }
                });
            }]
        }, function(oError, oResults) {
            exports.unlock(sFile, function() {
                fCallback(oError, oResults.hash);
            });
        });
    };

    exports.hashDirectoryFiles = function(sPath, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        //syslog.debug({action: 'fs-extended.hashDirectoryFiles', path: sPath});
        exec('sha1sum ' + path.join(sPath, '/*'), function(oError, sSTDOut, sSTDError) {
            if (oError) {
                syslog.error({action: 'fs-extended.hashDirectoryFiles.error', error: oError, stdErr: sSTDError});
                fCallback(oError);
            } else {
                var oHashes = {};
                var aSums   = sSTDOut.replace(/^\s+|\s+$/g, '').split('\n');

                for (var i in aSums) {
                    var aHash = aSums[i].replace(/^\s+|\s+$/g, '').split('  ');
                    oHashes[aHash[1]] = aHash[0];
                }

                syslog.debug({action: 'fs-extended.hashDirectoryFiles.done', output: oHashes});
                fCallback(null, oHashes);
            }
        });
    };

    exports.download = function(sUrl, sType, fCallback, iRedirects) {
        fCallback  = typeof fCallback == 'function' ? fCallback  : function() {};
        sType      = sType      || 'utf8';
        iRedirects = iRedirects || 0;

        var oHTTP = http;
        if (url.parse(sUrl).protocol == 'https:') {
            oHTTP = require('https');
        }

        oHTTP.get(sUrl, function(oResponse){
            if (oResponse.statusCode == 302 && iRedirects < 10) {
                exports.download(oResponse.headers.location, sType, fCallback, iRedirects + 1);
            } else {
                var sContents = '';

                oResponse.setEncoding(sType);
                oResponse.on('data', function (sChunk) {
                    sContents += sChunk;
                });

                oResponse.on('end', function () {
                    fCallback(sContents);
                });
            }
        });
    };

    exports.downloadFile = function(sUrl, sType, fCallback, iRedirects) {
        fCallback  = typeof fCallback == 'function' ? fCallback  : function() {};
        sType      = sType      || 'utf8';
        iRedirects = iRedirects || 0;


        var oUrl       = url.parse(sUrl);
        var sExtension = path.extname(oUrl.pathname);
        var oHTTP      = http;
        var sProtocol  = oUrl.protocol;

        if (sProtocol == 'https:') {
            oHTTP = require('https');
        } else if (sProtocol === null) {
            sUrl = 'http:' + sUrl;
        }

        var sTimer = syslog.timeStart('FSX.downloadFile');
        async.auto({
            randomName:               function(fAsyncCallback, oResults) { crypto.randomBytes(16,             fAsyncCallback);                                          },
            fullPath:  ['randomName', function(fAsyncCallback, oResults) { fAsyncCallback(null, exports.getTmpSync() + 'random-' + oResults.randomName.toString('hex')) }],
            download:  ['fullPath',   function(fAsyncCallback, oResults) {
                var oWriter     = fs.createWriteStream(oResults.fullPath, {
                    mode:       0777
                });

                oHTTP.get(sUrl, function(oResponse){
                    if (oResponse.statusCode == 302) {
                        if (iRedirects < 10) {
                            exports.downloadFile(oResponse.headers.location, sType, fCallback, iRedirects + 1);
                        } else {
                            fAsyncCallback(new Error('Too Many Redirects'));
                        }
                    } else {
                        oWriter.on('error', function(oError) {
                            syslog.error({action: 'fs-extended.downloadFile.writer.error', input: sUrl, output: oResults.fullPath, error: oError});
                            fAsyncCallback(oError);
                        });

                        oWriter.on('close', function() {
                            fAsyncCallback(null, oResults.fullPath);
                        });

                        oResponse.pipe(oWriter);
                    }
                });
            }],
            move:      ['download',   function(fAsyncCallback, oResults) {
                module.exports.moveFileToHashWithExtension(oResults.download, exports.getTmpSync(), sExtension, fAsyncCallback);
            }]
        }, function(oError, oResults) {
            if (oError) {
                syslog.error({action: 'fs-extended.downloadFile.error', input: sUrl, error: oError});
                return fCallback(oError);
            }

            syslog.timeStop(sTimer, {url: sUrl, type: sType, output: oResults});
            fCallback(null, oResults.move.path, oResults.move.hash);
        })
    };

    exports.mkdirP = function (sPath, iMode, fCallback) {
        if (process.platform === 'win32') {
            return fCallback('NO WIN32');
        }

        exec('mkdir -m ' + iMode + ' -p ' + sPath, function(oError, sStdOut, sStdErr) {
            if (oError) {
                syslog.error({action: 'fs-extended.mkdirP.error', error: oError});
                return  fCallback(oError);
            }

            fCallback(sStdErr);
        });
    };

    /**
     * @param {String}   sTempPath
     * @param {Array}    aFiles
     * @param {Function} fCallback
     */
    exports.concat = function(sTempPath, aFiles, fCallback) {
        var sFiles = aFiles.join(' ');
        var sPath  = sTempPath + Math.random().toString(36).substring(8);
        exec('cat ' + sFiles + ' >> ' +  sPath, function (oCatError, sStdOut, sStdErr) {
            if (oCatError) {
                syslog.error({action: 'fs-extended.concat.cat.error', error: oCatError});
                return  fCallback(oCatError);
            }

            exports.moveFileToHash(sPath, sTempPath, fCallback);
        });
    };

    /**
     *
     * @param {String} sFilePath
     * @param {String} sSize an integer and optional unit (example: 10M is 10*1024*1024).  Units are K, M, G, T, P, E, Z, Y (powers of 1024) or KB, MB, ... (powers of 1000).
     * @param {Function} fCallback
     */
    exports.split = function(sFilePath, sSize, fCallback) {
        var sPath = exports.getTmpSync() + 'split-' + Math.random().toString(36).substring(8) + '-';
        var splitCommand = 'split --verbose --bytes=' + sSize + ' ' + sFilePath + ' ' + sPath;
        if (process.platform == 'darwin') {
            splitCommand = 'split -b ' + sSize + ' ' + sFilePath + ' ' + sPath;
        }
        exec(splitCommand, function(oSplitError, sStdOut, sStdError) {
            if (oSplitError) {
                syslog.error({action: 'fs-extended.split.error', error: oSplitError});
                return  fCallback(oSplitError);
            }
            var aOutput = sStdOut.replace(/creating file/g, '')  // text prefixing filenames in output
                                 .replace(/[^a-z0-9\/\n-]/g, '') // surrounding quotes and backticks
                                 .replace(/[\s\n\t]+$/g, '')     // trim
                                 .split('\n');

            if (process.platform == 'darwin') {
                exec('ls -1 '+ sPath + '*', function(err,oStdOut,oStdErr) {
                    if (err) {
                        syslog.error({action: 'fs-extended.split.ls.error', error: err});
                        return fCallback(err);                        
                    }
                    else {
                        aOutput = oStdOut.split('\n');
                        aOutput.length = aOutput.length - 1;
                        fCallback(null, aOutput);
                    }
                });
            } 
            else {                          
                fCallback(null, aOutput);
            }
        });
    };

    /**
     *
     * @param {String} sFilePath
     * @param {Function} fCallback
     */
    exports.fileSize = function(sFilePath, fCallback) {
        fs.stat(sFilePath, function(oError, oStats) {
            if (oError) {
                return fCallback(oError);
            }

            fCallback(null, oStats.size);
        });
    };