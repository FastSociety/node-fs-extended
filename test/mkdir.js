    var fsX      = require('../fs-extended');

    fsX.mkdirP('./a/b/c', '0777', function(oError) {
        console.log(oError);
    });