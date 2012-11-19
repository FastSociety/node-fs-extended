    var async    = require('async');
    var fs       = require('fs');
    var path     = require('path');
    var fsX      = require('../fs-extended');

    module.exports = {
        setUp: function (callback) {
            this.file = __dirname + '/b9868fe7706226c58837da29c708b250a18c6ae3';
            callback();
        },

        tearDown: function (callback) {
            callback();
        },

        'Md5 To Base 64': function (test) {
            test.expect(2);

            fsX.md5FileToBase64(this.file, function(oError, sHash) {
                test.ifError(oError, 'Failed to create Hash Properly');
                test.equal(sHash, 'aCzYRrZcjbVqTIB27zZz1Q==', "File Hash is Correct");
                test.done();
            });
        }
    }; // END UNIT TEST
