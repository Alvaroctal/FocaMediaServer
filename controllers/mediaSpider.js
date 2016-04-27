var fs = require('fs');
var path = require('path');
var media = require(path.join(process.cwd(), 'controllers', 'media'));

module.exports = {
    getMediaBase: function() {
        return mediaBase;
    },
    indexMovies: function(directory, onEach, onFinish) {

        fs.readdir(directory, function (err, files) {

            if (err) onFinish('no-directory', directory);
            else {
                files.forEach(function (name) {

                    var pathName = path.join(directory, name);
                    var stat = fs.statSync(pathName);

                    if (stat.isFile()) {
                        if (movie = media.processMovie(name)) {
                            movie.path = pathName;
                            movie.size = stat.size;
                            onEach(null, directory, movie);
                        }
                        else {
                            onEach('no-regex', directory, { path: pathName, data: {name: name}  });
                        }
                    } 
                    else if (stat.isDirectory()) {

                        fs.readdir(pathName, function (err, files) {

                            if (err) onFinish(0, 'unexpected');
                            else {

                                var collection = name;

                                files.forEach(function (name) {

                                    var filePath = path.join(pathName, name);
                                    var stat = fs.statSync(filePath);

                                    if (stat.isFile()) {
                                        if (movie = media.processMovie(name)) {
                                            movie.path = filePath;
                                            movie.size = stat.size;
                                            movie.collection = collection;
                                            onEach(null, directory, movie);
                                        }
                                        else {
                                            onEach('no-regex', directory, { path: pathName, data: {name: name} })
                                        }
                                    } 
                                })
                            }
                        })
                    }
                })
            }   
        }); onFinish(null, directory);
    }
}

return module.exports;