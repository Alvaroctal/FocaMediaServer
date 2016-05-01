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
    },
    indexTvShows: function(directory, onEach, onFinish) {

        fs.readdir(directory, function (err, files) {

            if (err) onFinish('no-directory', directory);
            else {

                // ForEach TvShow
                
                files.forEach(function (tvshowName) {

                    var tvShowPath = path.join(directory, tvshowName);
                    var stat = fs.statSync(tvShowPath);

                    if (stat.isFile()) onEach('unexpected-file', directory, 'tvshow', { path: tvShowPath, data: {name: tvshowName}  });
                    else if (stat.isDirectory()) {

                        if (tvshow = media.processTvShow(tvshowName)) {

                            // Valid TvShow
                            
                            tvshow['path'] = tvShowPath;
                            tvshow['seasons'] = []; tvshow['oks'] = 0; tvshow['warns'] = 0;
                            onEach(null, directory, 'tvshow', tvshow);  

                            // ForEach Season

                            var seasonsNames = fs.readdirSync(tvShowPath);
                            for (var seasonIndex in seasonsNames) {

                                if (typeof seasonsNames[seasonIndex] === 'string') {

                                    var seasonPath = path.join(tvShowPath, seasonsNames[seasonIndex]);
                                    var stat = fs.statSync(seasonPath);

                                    if (stat.isFile()) { onEach('unexpected-file', directory, 'season', { name: seasonsNames[seasonIndex], path: seasonPath, tvshow: tvshowName }); tvshow.warns += season.warns; }
                                    else if (stat.isDirectory()) {

                                        if (season = media.processSeason(seasonsNames[seasonIndex], tvshow)) {

                                            // Valid Season

                                            season['path'] = seasonPath;
                                            season['episodes'] = []; season['oks'] = 0; season['warns'] = 0;
                                            season['episodesError'] = [];

                                            // ForEach Episode
                                            
                                            var episodesNames = fs.readdirSync(seasonPath);
                                            for (var episodeIndex in episodesNames) {

                                                if (path.extname(episodesNames[episodeIndex]) == '.srt') continue;
                                                if (typeof episodesNames[episodeIndex] === 'string') {

                                                    var episodePath = path.join(seasonPath, episodesNames[episodeIndex]);
                                                    var stat = fs.statSync(episodePath);

                                                    if (stat.isDirectory()) season.episodesError.push(episodesNames[episodeIndex]);
                                                    else if (stat.isFile()) {

                                                        if (episode = media.processEpisode(episodesNames[episodeIndex], season)) {

                                                            // Valid Episode
                                                            
                                                            episode['size'] = stat.size;
                                                            episode['path'] = episodePath;
                                                            season.episodes.push(episode);
                                                        }
                                                        else {
                                                            season.episodesError.push(episodesNames[episodeIndex]);
                                                        }
                                                    }
                                                }
                                            }  

                                            season.oks = Object.keys(season.episodes).length; season.warns = Object.keys(season.episodesError).length;
                                            tvshow.oks += season.oks; tvshow.warns += season.warns;
                                            tvshow.seasons.push(season);
                                        }
                                        else {
                                            onEach('no-regex', directory, 'season', { name: seasonsNames[seasonIndex], path: seasonPath, tvshow: tvshowName }); tvshow.warns++;
                                        }
                                    }
                                }
                            }

                            onEach(null, directory, 'tvshow', tvshow); 
                        }
                        else {
                            onEach('no-regex-tvshow', directory, 'tvshow', { name: tvshowName, path: tvShowPath });
                        }
                    }
                })
            }   
        })
    }
}

return module.exports;