    var fsX      = require('../fs-extended');
    var async    = require('async');

    var sOriginalHash = 'b9868fe7706226c58837da29c708b250a18c6ae3';

    async.auto({
        first:  function(fAsyncCallback, oResults) { fsX.copyFile('./' + sOriginalHash, './copy.test', fAsyncCallback); },
        second: function(fAsyncCallback, oResults) { fsX.copyFile('./' + sOriginalHash, './copy.test', fAsyncCallback); },
        third:  function(fAsyncCallback, oResults) { fsX.copyFile('./' + sOriginalHash, './copy.test', fAsyncCallback); },
        fourth: function(fAsyncCallback, oResults) { fsX.copyFile('./' + sOriginalHash, './copy.test', fAsyncCallback); },
        fifth:  function(fAsyncCallback, oResults) { fsX.copyFile('./' + sOriginalHash, './copy.test', fAsyncCallback); },
        sixth:  function(fAsyncCallback, oResults) { fsX.copyFile('./' + sOriginalHash, './copy.test', fAsyncCallback); }
    }, function(oError, oResults) {
        console.log('DONE', oError, oResults);

        if (!oError) {
            fsX.hashFile(oResults.first, function(oError, sHash) {
                console.log(oResults.first, sHash === sOriginalHash);
                fsX.removeDirectory(oResults.first, process.exit);
            });
        }
    });