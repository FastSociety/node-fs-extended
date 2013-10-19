    var fs      = require('fs');
    var path    = require('path');
    var util    = require('util');
    var url     = require('url');
    var http    = require('http');
    var crypto  = require('crypto');
    var async   = require('async');
    var exec    = require('child_process').exec;
    var syslog  = require('syslog-console').init('FSExtended');

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
                if (oStat.isDirectory()) {
                    // Mark-> the below was never cleaning up sPath in a local test
                    // exec('rm ' + path.join(sPath, '/*'), function() {
                    //     fs.rmdir(sPath, function() {
                    //         fCallback(sPath);
                    //     });
                    // });                    
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

    exports.copyFile = function(sFromFile, sToFile, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        var sTimer = syslog.timeStart('fs-extended.copyFile');
        if (sFromFile != sToFile) {
            //syslog.debug({action: 'fs-extended.copyFile', from: sFromFile, to: sToFile});
            // CANNOT use fs.rename due to partition limitations
            var oReader = fs.createReadStream(sFromFile);
            var oWriter = fs.createWriteStream(sToFile);
            oReader.pipe(oWriter);

            var bCallbackCalled = false;

            var fDone = function(oError, sToFile) {
                if (!bCallbackCalled) {
                    bCallbackCalled = true;
                    fCallback(oError, sToFile);
                }
            };

            oReader.on('error', function(oError) {
                syslog.debug({action: 'fs-extended.copyFile.reader.error', input: sFromFile, output: sToFile, error: oError});
                fDone(oError);
            });

            oWriter.on('error', function(oError) {
                syslog.debug({action: 'fs-extended.copyFile.writer.error', input: sFromFile, output: sToFile, error: oError});
                fDone(oError);
            });

            oWriter.on('close', function() {
                syslog.timeStop(sTimer, {output: sToFile});
                fDone(null, sToFile);
            });
        } else {
            //syslog.debug({action: 'fs-extended.copyFile.sameFile', output: sToFile});
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

        var sTimer = syslog.timeStart('fs-extended.hashFile');
        exec('sha1sum ' + sFile, function(oError, sSTDOut, sSTDError) {
            if (oError) {
                syslog.error({action: 'fs-extended.hashFile.error', error: oError, stdErr: sSTDError});
                fCallback(oError);
            } else {
                var aHash = sSTDOut.replace(/^\s+|\s+$/g, '').split(' ');
                var sHash = aHash[0];

                syslog.timeStop(sTimer, {output: sHash});
                fCallback(null, sHash);
            }
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


        var sExtension = path.extname(sUrl);
        var oSHASum    = crypto.createHash('sha1');
        var oHTTP      = http;
        var sProtocol  = url.parse(sUrl).protocol;

        if (sProtocol == 'https:') {
            oHTTP = require('https');
        } else if (sProtocol === null) {
            sUrl = 'http:' + sUrl;
        }

        var sTimer = syslog.timeStart('FSX.downloadFile');
        oHTTP.get(sUrl, function(oResponse){
            if (oResponse.statusCode == 302 && iRedirects < 10) {
                exports.downloadFile(oResponse.headers.location, sType, fCallback, iRedirects + 1);
            } else {
                var sContents = '';

                oResponse.setEncoding(sType);
                oResponse.on('data', function (sChunk) {
                    oSHASum.update(sChunk);
                    sContents += sChunk;
                });

                oResponse.on('error', function (oError) {
                    syslog.error({action: 'fs-extended.downloadFile.response.error', url: sUrl, type: sType, error: e});
                    fCallback(oError);
                });

                oResponse.on('end', function () {
                    var sHash      = oSHASum.digest('hex');
                    var sFinalFile = exports.getTmpSync() + sHash + sExtension;
                    fs.writeFile(sFinalFile, sContents, sType, function(oError) {
                        if (oError) {
                            syslog.error({action: 'fs-extended.downloadFile.write.error', url: sUrl, type: sType, error: oError});
                            fCallback(oError);
                        } else {
                            fs.chmod(sFinalFile, 0777, function() {
                                syslog.timeStop(sTimer, {url: sUrl, type: sType});
                                fCallback(null, sFinalFile, sHash);
                            });
                        }
                    });
                });
            }
        }).on('error', function(e) {
            syslog.error({action: 'fs-extended.downloadFile.request.error', url: sUrl, type: sType, error: e});
            fCallback(e);
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