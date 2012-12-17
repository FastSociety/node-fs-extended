    var fs      = require('fs');
    var path    = require('path');
    var util    = require('util');
    var url     = require('url');
    var http    = require('http');
    var crypto  = require('crypto');
    var async   = require('async');
    var exec    = require('child_process').exec
    var syslog  = require('syslog-console').init('FSExtended');

    exports.clearTmp = function(fCallback) {
        var sTmp = exports.getTmpSync();
        exports.removeDirectory(sTmp, function() {
            exports.mkdirP(sTmp, 0777, fCallback);
        });
    };

    exports.getTmp = function(fCallback) {
        fCallback(exports.getTmpSync());
    };

    exports.getTmpSync = function() {
        return '/tmp/cameo/' + process.pid + '/';
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
                if (oStat.isDirectory()) {
                    exec('rm ' + path.join(sPath, '/*'), function() {
                        fs.rmdir(sPath, function() {
                            fCallback(sPath);
                        });
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

    exports.copyFile = function(sFromFile, sToFile, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        var iStart = syslog.timeStart();
        if (sFromFile != sToFile) {
            syslog.debug({action: 'fs-extended.copyFile', from: sFromFile, to: sToFile});
            util.pump(fs.createReadStream(sFromFile), fs.createWriteStream(sToFile), function(oError) { // CANNOT use fs.rename due to partition limitations
                if (oError) {
                    syslog.error({action: 'fs-extended.copyFile.error', error: oError});
                    fCallback(oError);
                } else {
                    syslog.timeStop(iStart, {action: 'fs-extended.copyFile.done', output: sToFile});
                    fCallback(null, sToFile);
                }
            });
        } else {
            syslog.debug({action: 'fs-extended.copyFile.sameFile', output: sToFile});
            fCallback(null, sToFile);
        }
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

        var iStart = syslog.timeStart();
        syslog.debug({action: 'fs-extended.copyFileToHash', from: sFromFile, path: sPath, extension: sExtension});
        exports.hashFile(sFromFile, function(oError, sHash) {
            if (oError) {
                syslog.debug({action: 'fs-extended.copyFileToHash.hashFile.error', error: oError});
                fCallback(oError);
            } else {
                var sDestination = path.join(sPath, sHash) + sExtension;
                exports.copyFile(sFromFile, sDestination, function(oCopyError, sDestination) {
                    if (oCopyError) {
                        syslog.debug({action: 'fs-extended.copyFileToHash.copyFile.error', error: oCopyError});
                        fCallback(oCopyError);
                    } else {
                        var oOutput = {
                            path: sDestination,
                            hash: sHash
                        };

                        syslog.timeStop(iStart, {action: 'fs-extended.copyFileToHash.done', output: oOutput});
                        fCallback(null, oOutput);
                    }
                });
            }
        });
    };

    /**
     *
     * @param {String} sFromFile
     * @param {String} sPath
     * @param {String} [sExtension]
     * @param {Function} fCallback
     */
    exports.moveFileToHash = function(sFromFile, sPath, sExtension, fCallback) {
        if (typeof sExtension == 'function') {
            fCallback  = sExtension;
            sExtension = '';
        }

        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        var iStart = syslog.timeStart();
        syslog.debug({action: 'fs-extended.moveFileToHash', from: sFromFile, path: sPath, extension: sExtension});
        exports.hashFile(sFromFile, function(oError, sHash) {
            if (oError) {
                syslog.debug({action: 'fs-extended.moveFileToHash.hashFile.error', error: oError});
                fCallback(oError);
            } else {
                var sDestination = path.join(sPath, sHash) + sExtension;
                exports.moveFile(sFromFile, sDestination, function(oMoveError, sDestination) {
                    if (oMoveError) {
                        syslog.debug({action: 'fs-extended.moveFileToHash.moveFile.error', error: oMoveError});
                        fCallback(oMoveError);
                    } else {
                        var oOutput = {
                            path: sDestination,
                            hash: sHash
                        };

                        syslog.timeStop(iStart, {action: 'fs-extended.moveFileToHash.done', output: oOutput});
                        fCallback(null, oOutput);
                    }
                });
            }
        });
    };

    exports.moveFile = function(sFromFile, sToFile, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        if (sFromFile != sToFile) {
            var iStart = syslog.timeStart();
            syslog.debug({action: 'fs-extended.moveFile', from: sFromFile, to: sToFile});
            exports.copyFile(sFromFile, sToFile, function(oCopyError) {
                if (oCopyError) {
                    syslog.error({action: 'fs-extended.moveFile.copy', error: oCopyError});
                }

                fs.unlink(sFromFile, function(oUnlinkError) {
                    if (oUnlinkError) {
                        syslog.error({action: 'fs-extended.moveFile.unlink', error: oUnlinkError});
                    }

                    syslog.timeStop(iStart, {action: 'fs-extended.moveFile.done', output: sToFile});
                    fCallback(null, sToFile);
                });
            });
        } else {
            syslog.debug({action: 'fs-extended.moveFile.sameFile', output: sToFile});
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

        syslog.debug({action: 'fs-extended.md5FileToBase64', input: sFile});
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

        var iStart = syslog.timeStart();
        syslog.debug({action: 'fs-extended.hashFile', input: sFile});
        exec('sha1sum ' + sFile, function(oError, sSTDOut, sSTDError) {
            if (oError) {
                syslog.error({action: 'fs-extended.hashFile.error', error: oError, stdErr: sSTDError});
                fCallback(oError);
            } else {
                var aHash = sSTDOut.replace(/^\s+|\s+$/g, '').split(' ');
                var sHash = aHash[0];

                syslog.timeStop(iStart, {action: 'fs-extended.hashFile.done', output: sHash});
                fCallback(null, sHash);
            }
        });
    };

    exports.hashDirectoryFiles = function(sPath, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        syslog.debug({action: 'fs-extended.hashDirectoryFiles', path: sPath});
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

    exports.downloadFile = function(sUrl, sType, fCallback, iRedirects) {
        fCallback  = typeof fCallback == 'function' ? fCallback  : function() {};
        sType      = sType      || 'utf8';
        iRedirects = iRedirects || 0;

        var oUrl = url.parse(sUrl);

        var oOptions = {
            host: oUrl.hostname,
            port: 80,
            path: oUrl.pathname
        };

        var sExtension = path.extname(sUrl);

        var oSHASum    = crypto.createHash('sha1');
        http.get(oOptions, function(oResponse){
            if (oResponse.statusCode == 302 && iRedirects < 10) {
                exports.downloadFile(oResponse.headers.location, sType, fCallback, iRedirects + 1);
            } else {
                var sContents = '';

                oResponse.setEncoding(sType);
                oResponse.on('data', function (sChunk) {
                    oSHASum.update(sChunk);
                    sContents += sChunk;
                });

                oResponse.on('end', function () {
                    var sHash      = oSHASum.digest('hex');
                    var sFinalFile = exports.getTmpSync() + sHash + sExtension;
                    fs.writeFile(sFinalFile, sContents, sType, function(oError) {
                        fs.chmod(sFinalFile, 0777, function() {
                            fCallback(sFinalFile, sHash);
                        });
                    });
                });
            }
        });
    };

    /**
     * From https://github.com/bpedro/node-fs
     * Offers functionality similar to mkdir -p
     *
     * Asynchronous operation. No arguments other than a possible exception
     * are given to the completion callback.
     */
    exports.mkdirP = function (path, mode, callback, position) {
        var osSep = process.platform === 'win32' ? '\\' : '/';
        var parts = require('path').normalize(path).split(osSep);

        mode = mode || process.umask();
        position = position || 0;

        if (position >= parts.length) {
            if (typeof callback == "function") {
                return callback();
            } else {
                return;
            }
        }

        var directory = parts.slice(0, position + 1).join(osSep) || osSep;
        fs.exists(directory, function(bExists) {
            if (bExists) {
                exports.mkdirP(path, mode, callback, position + 1);
            } else {
                fs.mkdir(directory, mode, function (err) {
                    if (err && err.errno != 17) {
                        return callback(err);
                    } else {
                        exports.mkdirP(path, mode, callback, position + 1);
                    }
                });
            }
        });
    };