    var fsX      = require('../fs-extended');
    var cluster  = require('cluster');

    var sOriginalHash = 'b9868fe7706226c58837da29c708b250a18c6ae3';
    var sOutput       = './copy.test';

    if (cluster.isMaster) {
        // Fork workers.
        var iDone    = 0;
        var iHowMany = 5;
        for (var i = 0; i < iHowMany; i++) {
            cluster.fork();
        }

        cluster.on('exit', function(worker, code, signal) {
            iDone++;

            if (iDone >= iHowMany) {
                fsX.removeDirectory(sOutput, process.exit);
            }
        });
    } else {
        fsX.copyFile('./' + sOriginalHash, sOutput, function(oError, sFile) {
            console.log('DONE', oError, sFile);

            if (!oError) {
                fsX.hashFile(sFile, function(oError, sHash) {
                    console.log(sFile, sHash === sOriginalHash);
                    process.exit();
                });
            }
        });
    }