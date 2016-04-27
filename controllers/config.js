/*
 *  Config Module
 *
 *  Author: Alvaro Octal
 *  Date: 02/04/2016
 */

var fs = require('fs');
var path = require('path');

module.exports = {
    data: null,
    configPath: path.join(process.cwd(), 'data', 'config.json'),
    spider: require(path.join(process.cwd(), 'controllers', 'mediaSpider')),
    load: function() {
        try {
            fs.statSync(this.configPath).isFile();
            try {
                this.data = require(this.configPath);
            } catch (e) {
                console.log('Error: Malformed JSON config');
            }
        } catch (e) {
            console.log('Warn: Unable to find JSON config');
            this.data = {
                directories: {}
            }
        }
    },
    save: function() {
        fs.writeFile(this.configPath, JSON.stringify(this.data), function (err) {
            return !err;
        });
    },
    getSpider: function() {
        return this.spider;
    },
    getBackground: function() {
        return this.data.background;
    },
    setBackground: function(background) {
        this.data.background = background;
        this.save();
    },
    getDirectories: function() {
        return this.data.directories;
    },
    setDirectories: function(directories) {
        this.data.directories = directories;
        this.save();
    },
    getApiKey: function() {
        return this.data.api_key;
    },
    setApiKey: function(api_key) {
        this.data.api_key = api_key;
        this.save();
    },
    getSessionID: function() {
        return this.data.session_id;
    },
    setSessionID: function(session_id) {
        this.data.session_id = session_id;
        this.save();
    }
}

return module.exports;