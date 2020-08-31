const SimpleNodeLogger = require('simple-node-logger'),
    opts = {
        logFilePath:'logfile.log',
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    },
    log = SimpleNodeLogger.createSimpleLogger( opts );

function logInfo(message, context = []) {
    log.info(message + "\n", context);
    log.info("\n\n");
}

module.exports = {
    logInfo,
};