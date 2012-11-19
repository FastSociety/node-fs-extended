    var fs      = require('fs');
    var path    = require('path');
    var util    = require('util');
    var url     = require('url');
    var http    = require('http');
    var crypto  = require('crypto');
    var async   = require('async');
    var exec    = require('child_process').exec

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

        if (sFromFile != sToFile) {
            util.pump(fs.createReadStream(sFromFile), fs.createWriteStream(sToFile), function(oError) { // CANNOT use fs.rename due to partition limitations
                if (oError) {
                    fCallback(oError);
                } else {
                    exports.copyDirectoryPropertiesToFile(sToFile, function() {
                        fCallback(null, sToFile);
                    });
                }
            });
        } else {
            exports.copyDirectoryPropertiesToFile(sToFile, function() {
                fCallback(null, sToFile);
            });
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
    exports.moveFileToHash = function(sFromFile, sPath, sExtension, fCallback) {
        if (typeof sExtension == 'function') {
            fCallback  = sExtension;
            sExtension = '';
        }

        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        exports.hashFile(sFromFile, function(oError, sHash) {
            if (oError) {
                fCallback(oError);
            } else {
                var sDestination = path.join(sPath, sHash) + sExtension;
                exports.moveFile(sFromFile, sDestination, function(oMoveError, sDestination) {
                    fCallback(oMoveError, {
                        path: sDestination,
                        hash: sHash
                    });
                });
            }
        });
    };

    exports.moveFile = function(sFromFile, sToFile, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        exports.copyFile(sFromFile, sToFile, function(oCopyError) {
            if (oCopyError) {
                console.error('fsX.move.copy.error', oCopyError)
            }

            if (sFromFile != sToFile) {
                fs.unlink(sFromFile, function(oUnlinkError) {
                    if (oUnlinkError) {
                        console.error('fsX.move.unlink.error', oUnlinkError)
                    }

                    fCallback(null, sToFile);
                });
            } else {
                fCallback(null, sToFile);
            }
        });
    };

    exports.directorySize = function(sPath, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        exec('du -s ' + sPath, function(oError, sSTDOut, sSTDError) {
            if (oError) {
                fCallback(oError);
            } else {
                var aDU = sSTDOut.replace(/^\s+|\s+$/g, '').split(' ');
                fCallback(null, aDU[0]);
            }
        });
    };

    exports.md5FileToBase64 = function(sFile, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        exec('openssl dgst -md5 -binary ' + sFile + ' | openssl enc -base64', function(oError, sSTDOut, sSTDError) {
            if (oError) {
                fCallback(oError);
            } else {
                var aHash = sSTDOut.replace(/^\s+|\s+$/g, '').split(' ');
                fCallback(null, aHash[0]);
            }
        });
    };

    exports.hashFile = function(sFile, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        exec('sha1sum ' + sFile, function(oError, sSTDOut, sSTDError) {
            if (oError) {
                fCallback(oError);
            } else {
                var aHash = sSTDOut.replace(/^\s+|\s+$/g, '').split(' ');
                fCallback(null, aHash[0]);
            }
        });
    };

    exports.hashDirectoryFiles = function(sPath, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        exec('sha1sum ' + path.join(sPath, '/*'), function(oError, sSTDOut, sSTDError) {
            if (oError) {
                fCallback(oError);
            } else {
                var oHashes = {};
                var aSums   = sSTDOut.replace(/^\s+|\s+$/g, '').split('\n');

                for (var i in aSums) {
                    var aHash = aSums[i].replace(/^\s+|\s+$/g, '').split('  ');
                    oHashes[aHash[1]] = aHash[0];
                }

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
                    var sFinalFile = '/tmp/' + sHash + sExtension;
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
            return callback();
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