var mediaLibrary = angular.module('MediaLibrary', ['file-model']);

var userDataPath = require('electron').remote.app.getPath('userData');

//------------------------------------------------------------------------------
//  Storage Service
//------------------------------------------------------------------------------

mediaLibrary.factory('StorageService', function($q){
    
    var data = null;
    const storage = require('electron-json-storage');
    var def = $q.defer();

    storage.get('config', function(error, loadedData) {

        console.log()

        if (error) def.reject(error);
        else {
            data = loadedData.directories ? loadedData : {'directories': {'movies': {}, 'tvshows': {}}, 'stream': { 'mode': 'cache'}};
            def.resolve();
        }
    });

    return {
        load: function() {
            return def.promise;
        },
        get: function(key) {
            return data[key];
        },
        set: function(key, value) {
            data[key] = value;
            storage.set('config', data);
        }
    }
});

//------------------------------------------------------------------------------
//  Directories Service
//------------------------------------------------------------------------------

mediaLibrary.factory('DirectoriesService', ['StorageService', function (StorageService) {

    var directories = null;
    StorageService.load().then(function() {
        directories = StorageService.get('directories');
    });
    
    return {
        getDirectories: function (media) {
            return directories[media];
        },
        addDirectory: function (media, path, timestamp) {
            directories[media][path] = timestamp;
            StorageService.set('directories', angular.copy(directories));
        },
        removeDirectory: function (media, path) {
            delete directories[media][path];
            StorageService.set('directories', angular.copy(directories));
        }
    };
}]);

//------------------------------------------------------------------------------
//  Media Service
//------------------------------------------------------------------------------

var Datastore = require('nedb');  
var db = new Datastore({ filename: path.join(userDataPath, 'db.json'), autoload: true });

mediaLibrary.factory('MediaService', function() {

    var crypto = require('crypto');
    
    return {
        createID: function(media) {
            return crypto.createHash('sha1').update(media.path).digest('hex')
        },
        getByID: function(id, callback) {
            db.findOne({ 'data.id': parseInt(id) }, callback);
        },
        getAutoPending: function(callback) {
            db.findOne({data:{$exists:false}}, callback)
        },
        getPending: function(callback) {
            db.findOne({data:-1}, callback)
        },
        upsert: function(type, media) {
            var id = this.createID(media);
            db.update( 
                { _id: id },
                {   
                    $set: {
                        _id: id,
                        type: type,
                        local: media
                    }
                },
                { upsert: true }
            );
        },
        upsertData: function(id, data) {
            db.update( 
                { _id: id },
                {   
                    $set: {
                        data: data
                    }
                },
                { upsert: true }
            )
        },
        upsertSeasonData: function(tvshow, season, data) {
            db.update(
                {'type': 'tvshow', 'data.id': tvshow, 'data.seasons.season_number': season}, 
                {
                    $set: {
                        'data.seasons.$': data
                    }
                }
            );
        },
        getResolved: function(type, callback) {
            return db.find({type: type, $not: {data: {$gt:-2}}}, callback);
        },
        getWatchlist: function(media_type, callback) {
            db.find({ watchlist: true, type: media_type }, callback);
        },
        watchlist: function(media_id, watchlist, callback) {
            db.update( 
                { 'data.id': parseInt(media_id) },
                {   
                    $set: {
                        watchlist: watchlist ? true : false
                    }
                }, callback
            );
        }
    }
});

//------------------------------------------------------------------------------
//  API Service
//------------------------------------------------------------------------------

mediaLibrary.factory('APIService', ['$q', 'StorageService', function($q, StorageService) {

    var api = [];
    var created = $q.defer();
    var connected = $q.defer();

    StorageService.load().then(function() {
        if (StorageService.get('api_key')) {

            api = require('moviedb')(StorageService.get('api_key'));
            api.session_id = StorageService.get('session_id');

            if (api.session_id) {
                api.accountInfo(function(err, res) {
                    
                    if (! err) {
                        connected.resolve(res);
                        api.account = res;
                    }
                    else created.reject(err);
                });
            }

            created.resolve(api);
        }
    });

    return {
        load: function() {
            return created.promise;
        },
        connect: function() {
            return connected.promise;
        },
        get: function() {
            return api;
        },
        setAPIKey: function(api_key) {
            api = require('moviedb')(api_key);
        },
        setSessionID: function(session_id) {
            api['session_id'] = session_id;
        },
        setAccount: function(account) {
            api['account'] = account;
        },
        destroySession: function() {
            delete api.account;
            delete api.session_id;
        }
    }
}]);

//------------------------------------------------------------------------------
//  Aplication Controller
//------------------------------------------------------------------------------

mediaLibrary.controller('appController', function($scope, $timeout, DirectoriesService, APIService, MediaService){

    APIService.connect().then(function(data) { $scope.account = data });

    // Views & Dialogs
    
    $scope.view = 'start';
    $scope.dialog = './views/dialogs/loading.html';

    $scope.getView = function() { return './views/containers/' + $scope.view + '.html' }
    $scope.setView = function(view) { $scope.view = view }
    $scope.showDialog = function(dialog) { 
        $scope.dialog = './views/dialogs/' + dialog + '.html'; 
        $('#dialog').data('dialog').open();
    }

    // Server Code, will be refactored
    
    var polo = require('polo');
    var port = 14123;
    var apps = polo({ monitor: true });
    var express = require('express');
    var bodyParser = require('body-parser');
    var Transcoder = require('stream-transcoder')
    var app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true })); 
    app.use('/mirror', express.static(path.join(userDataPath, 'mirror')));

    app.get('/', function (req, res) { res.json({ status: 1, action: 'status', data: 'everything looks fine here.' }) });
    app.get('/index', function (req, res) { res.json({ status: 1, action: 'index', data: db.getAllData() }) });
    app.get('/watchlist/movies/', function (req, res) { 
        MediaService.getWatchlist('movie', function(err, result) {
            if (!err) {
                res.json({ status: 1, action: 'get-watchlist-movies', data: result });
            } else {
                res.json({ status: 0, action: 'get-watchlist-movies', data: '' });
            }
        });
    });
    app.get('/watchlist/tv/', function (req, res) { 
        MediaService.getWatchlist('tvshow', function(err, result) {
            if (!err) {
                res.json({ status: 1, action: 'get-watchlist-tv', data: result });
            } else {
                res.json({ status: 0, action: 'get-watchlist-tv', data: '' });
            }
        });
    });
    app.post('/watchlist', function (req, res) { 

        MediaService.watchlist(req.body.media_id, req.body.watchlist, function(err, result) {
            if (!err) {
                console.log(req.body);
                res.json({ status: 1, action: 'watchlist', data: result });
            } else {
                res.json({ status: 0, action: 'watchlist', data: result });
            }
        });

        /*if ($scope.account) {
            APIService.get().accountWatchlist({ 'id': APIService.get().account.id, 'media_type': req.body.media_type, 'media_id': req.body.media_id, 'watchlist': req.body.watchlist }, function(err, res) {
                console.log(err);
                console.log(JSON.stringify(res));
            });
        }*/
    });

    var convert = function(pathIn, pathOut) {
        var streamIn = fs.createReadStream(pathIn);
        var streamOut = fs.createWriteStream(pathOut);

        new Transcoder(streamIn)
            .maxSize(1280, 720)
            .videoCodec('h264')
            .videoBitrate(800 * 1000)
            .fps(24)
            .audioCodec('aac')
            .sampleRate(44100)
            .channels(2)
            .audioBitrate(128 * 1000)
            .format('mp4')
            .on('finish', function() {
                console.log('a ver que podemos borrar');
            })
            .stream().pipe(streamOut);
    }

    app.get(/^\/watch\/movie-([0-9]*).mp4$/, function(req, res) {

        MediaService.getByID(req.params[0], function(err, movie) {

            if (!err) {
                if (movie) {
                    console.log('creando movie ' + movie.data.id);

                    res.writeHead(206, { 'Content-Type': 'video/mp4' });

                    var streamIn = fs.createReadStream(movie.local.path);

                    new Transcoder(streamIn)
                        .maxSize(1280, 720)
                        .videoCodec('h264')
                        .videoBitrate(800 * 1000)
                        .fps(24)
                        .audioCodec('aac')
                        .sampleRate(44100)
                        .channels(2)
                        .audioBitrate(128 * 1000)
                        .format('mp4')
                        .on('finish', function() {
                            console.log('a ver que podemos borrar');
                        })
                        .stream().pipe(res);

                }
            }
        });
    });

    app.use(function(req,res){

        var matchMovie = /^\/mirror\/watch\/movie-([0-9]*).mp4$/.exec(req.url);
        var matchTvEpisode = /^\/mirror\/watch\/tvshow-([0-9]*)-([0-9]*)-([0-9]*).mp4$/.exec(req.url);

        if (matchMovie) { // Tries to reach a movie

            MediaService.getByID(matchMovie[1], function(err, movie) {

                if (!err) {
                    if (movie) {
                        console.log('creando movie ' + movie.data.id);

                        convert(movie.local.path, path.join(userDataPath, 'mirror', 'watch', 'movie-' + movie.data.id + '.mp4'));

                        $timeout(function() {res.redirect(req.url)}, 5000);
                    } else {
                        res.json({ status: 1, action: 'watch-movie', data: 'not-found-movie' });
                    }
                } else {
                    res.json({ status: 1, action: 'watch-movie', data: 'not-found' });
                }
            })
        } else if (matchTvEpisode) { // Tries to reach a tv episode

            MediaService.getByID(matchTvEpisode[1], function(err, tvshow) {

                if (!err) {

                    var episode = tvshow.local.seasons.find(function(season) { return season.number == matchTvEpisode[2]}).episodes.find(function(episode) { return episode.number == matchTvEpisode[3]})
                    
                    if (episode) {
                        console.log('creando episode ' + matchTvEpisode[1]);

                        convert(episode.path, path.join(userDataPath, 'mirror', 'watch', 'tvshow-' + tvshow.data.id + '-' + episode.season + '-' + episode.number + '.mp4'));

                        $timeout(function() {res.redirect(req.url)}, 5000);
                    } else {
                        res.json({ status: 1, action: 'watch-tv', data: 'not-found-episode' });
                    }
                } else {
                    res.json({ status: 1, action: 'watch-tv', data: 'not-found-tvshow' });
                }
            });
        } else {
            res.status(404);
            res.json({ status: 0, action: 'not-found', data: 'Not Found' });
        } 
    });

    app.listen(port, function() {
        apps.put({ name: 'foca-media', port: port });
    });

});

//------------------------------------------------------------------------------
//  Account Controller
//------------------------------------------------------------------------------

mediaLibrary.controller('accountController', function($scope, APIService, StorageService) {

    // Account
    
    APIService.load().then(function(data) { $scope.api = data });

    var clipboard = require('electron').clipboard;

    $scope.status = {};

    $scope.setApiKey = function() {

        APIService.setAPIKey($scope.api.api_key);

        $scope.status['api_key'] = 0;

        APIService.get().configuration(function(err, res) {
            if (! err) {
                $scope.status['api_key'] = 1;
                $scope.$apply();

                // Save new API Key
                
                StorageService.set('api_key', APIService.get().api_key);

                $scope.getRequestToken();
            }
            else {
                $scope.status['api_key'] = -1;
                $scope.$apply();
            }
        });
    }

    $scope.getRequestToken = function () {
        
        $scope.status['request_token'] = 0;

        APIService.get().requestToken(function(err, res) {
            if (! err) {
                $scope.api = APIService.get();
                $scope.status['request_token'] = 1;
                $scope.$apply();
            }
            else {
                $scope.status['request_token'] = -1;
                $scope.$apply();
            }
        });
    }

    $scope.openSession = function () {
        
        $scope.status['session_id'] = 0;

        console.log(APIService.get());

        APIService.get().session(function(err) {
            
            if (! err) {

                StorageService.set('session_id', APIService.get().session_id);

                APIService.get().accountInfo(function(err, res) { 
                    if (! err) {
                        APIService.setAccount(res);
                        $scope.status['session_id'] = 1;
                        $scope.$apply();
                    }
                    else {
                        $scope.status['session_id'] = -1;
                        $scope.$apply();
                        console.log(err);
                    }
                });
                
            }
            else {
                $scope.status['session_id'] = -1;
                $scope.$apply();
            }
        });
    }

    $scope.closeSession = function() {
        $scope.status.session_id = null;
        APIService.destroySession();
        $scope.status.request_token = null;
    }

    $scope.copyToClipboard = function(text) {
        clipboard.writeText(text);
    }
});

//------------------------------------------------------------------------------
//  Directories Controller
//------------------------------------------------------------------------------

mediaLibrary.controller('directoriesController', function($scope, DirectoriesService) {

    // Directories
    
    $scope.getDirectories = function(media) { return DirectoriesService.getDirectories(media) }
    $scope.addDirectory = function(newDirectory) { DirectoriesService.addDirectory($('#dialog ul.tabs li.active').attr('data-media'), newDirectory.path, newDirectory.lastModified) }
    $scope.removeDirectory = function(media, directory) { DirectoriesService.removeDirectory(media, directory) }
});

//------------------------------------------------------------------------------
//  Spider Controller
//------------------------------------------------------------------------------

mediaLibrary.controller('spiderController', function($scope, DirectoriesService, MediaService) {

    // Spider Log
    
    $scope.moviesLog = DirectoriesService.getDirectories('movies');
    $scope.tvshowsLog = DirectoriesService.getDirectories('tvshows');

    $scope.init = function() {
        $scope.indexMovies();
        $scope.indexTvShows();
    }

    $scope.indexMovies = function() {

        Object.keys($scope.moviesLog).forEach(function(directory) {

            $scope.moviesLog[directory] = { movies: [], oks: 0, warns: 0, error: null } 

            mediaSpider.indexMovies(directory, function(error, directory, data) {

                $scope.moviesLog[directory].movies.push({ warn: error, name: (data.title || data.data.name) });

                if (error) $scope.moviesLog[directory].warns++;
                else {
                    MediaService.upsert('movie', data);
                    $scope.moviesLog[directory].oks++;
                }

                if (data.collection) $scope.$apply() // BUG SHITTY FIX

            }, function(error, directory) {
                if (error) {
                    $scope.moviesLog[directory].movies.push({ error: error });
                    $scope.moviesLog[directory].error = error;
                    $scope.$apply()
                }
            });
        });
    }

    $scope.indexTvShows = function() {

        Object.keys($scope.tvshowsLog).forEach(function(directory) {

            $scope.tvshowsLog[directory] = { tvshows: {}, oks: 0, warns: 0, error: null } 

            mediaSpider.indexTvShows(directory, function(error, directory, type, data) {

                if (error) {
                    if (type == 'season') {
                        $scope.tvshowsLog[directory].tvshows[data.tvshow].seasons.push({ warn: error, name: data.name });
                    }
                    else if (type == 'tvshow') {
                        console.log('hola');
                        console.log(data);
                    }
                }
                else if (type == 'tvshow') {

                    // Valid TvShow
                    
                    MediaService.upsert('tvshow', angular.copy(data));

                    $scope.tvshowsLog[directory].tvshows[data.name] = data;
                    $scope.tvshowsLog[directory].oks += data.oks; $scope.tvshowsLog[directory].warns += data.warns;
                }

            }, function(error, directory) {
                if (error) {
                    $scope.tvshowsLog[directory].tvshows['error'] = { error: error };
                    $scope.tvshowsLog[directory].error = error;
                    $scope.$apply()
                }
            });
        });
    }
});

mediaLibrary.controller('validationController', function($scope, $timeout, MediaService, APIService) {

    $scope.index = 0;
    $scope.pending = null;
    $scope.auto = true;

    var autoResolveNotification = null;
    var autoResolveProgress = null;
    var delay = 300;
    var lang = 'es';

    var posterWidths = [92, 154, 185];
    var mkdirp = require('mkdirp');
    mkdirp(path.join(userDataPath, 'mirror', 'watch'), function (err) { if (err) console.error(err) });
    posterWidths.forEach(function(posterWidth) { mkdirp(path.join(userDataPath, 'mirror', 't', 'p', 'w' + posterWidth), function (err) { if (err) console.error(err) }) });

    $timeout( function(){ if ($scope.auto) $scope.autoResolve(); else $scope.getPending() }, 500);

    // Get Movie

    $scope.getMovie = function(id, callback) {

        if ($scope.pending) $scope.pending.working = true;

        APIService.get().movieInfo({id: id, language: lang, append_to_response: 'videos,images'}, function(err, movie){
            MediaService.upsertData($scope.pending._id, (movie ? movie : -1));

            cachePoster(movie);
            $timeout(callback, delay);
        });
    }

    // Get TvShow

    $scope.getTvShow = function(id, callback) {

        if ($scope.pending) $scope.pending.working = true;

        APIService.get().tvInfo({id: id, language: lang, append_to_response: 'videos,images'}, function(err, tvshow) {

            cachePoster(tvshow);
            
            // Get seasons
            
            $timeout(function() {

                var nextSeason = function(seasonIndex) {
                    if (tvshow.seasons[seasonIndex]) {

                        $scope.getTvSeason(tvshow.id, tvshow.seasons[seasonIndex].season_number, function(season) {
                            tvshow.seasons[seasonIndex] = season;

                            seasonIndex++;
                            nextSeason(seasonIndex);
                        });
                    }
                    else {
                        MediaService.upsertData($scope.pending._id, (tvshow ? tvshow : -1));
                        callback();
                    }
                }; nextSeason(0);

            }, delay);
        });
    }

    // Get Season

    $scope.getTvSeason = function(id, season_number, callback) {
        APIService.get().tvSeasonInfo({id: id, season_number: season_number, language: lang, append_to_response: 'videos,images'}, function(err, season){
            MediaService.upsertData($scope.pending._id, (season ? season : -1));
            
            cachePoster(season);
            $timeout(function() { callback(season) }, delay);
        });
    }

    var cachePoster = function(media) {
        if (media.poster_path) {
            posterWidths.forEach(function(posterWidth) { 
                https.get('https://image.tmdb.org/t/p/w' + posterWidth + media.poster_path, function(response) {
                    if (response.statusCode === 200) response.pipe(fs.createWriteStream(path.join(userDataPath, 'mirror', 't', 'p', 'w' + posterWidth, media.poster_path))); 
                })
            })
        }
    }

    // Automatic Resolve

    $scope.autoResolve = function() {
        
        MediaService.getAutoPending(function(err, res) {

            $scope.pending = res;

            if (res) {
                if (! autoResolveNotification) {
                    autoResolveNotification = $.Notify({
                        type: 'success',
                        caption: 'Resolviendo...',
                        content: '<div id="progress-resolve" class="progress ani" data-color="ribbed-amber" data-role="progress"></div>',
                        icon: '<span class="mif-film"></span>',
                        keepOpen: true
                    });
                }
                else {
                    if (!autoResolveProgress) autoResolveProgress = $('#progress-resolve').data('progress');
                    if (autoResolveProgress) {
                        db.count({data:{$exists:true}}, function(err, countDone) {
                            db.count({}, function(err, countTotal) {
                                autoResolveProgress.set((countDone * 100) / countTotal);
                            })
                        })
                    }
                }      
                
                if ($scope.pending.type == 'movie') {

                    // Incoming item is a Movie

                    APIService.get().searchMovie({ query: $scope.pending.local.title, year: $scope.pending.local.year, language: lang }, function(err, res) {
                        
                        if ($scope.pending.data = res.results[0]) {

                            // Movie matched
                            
                            $timeout($scope.getMovie(res.results[0].id, $scope.autoResolve), delay);
                        }
                        else {
                            MediaService.upsertData($scope.pending._id, -1);
                            $timeout($scope.autoResolve, delay);
                        }
                    })
                }
                else if ($scope.pending.type == 'tvshow') {

                    // Incoming item is a TvShow
                    
                    APIService.get().searchTv({ query: $scope.pending.local.name, language: lang }, function(err, res) {
                        if ($scope.pending.data = res.results[0]) {

                            // TvShow matched
                            
                            $timeout(function() {
                                $timeout($scope.getTvShow(res.results[0].id, $scope.autoResolve), delay);
                            }, delay);
                        }
                        else {
                            MediaService.upsertData($scope.pending._id, -1);
                            $timeout($scope.autoResolve, delay);
                        }
                    })
                }
            }
            else {

                // Tried to match all items

                if (autoResolveNotification) autoResolveNotification.close();
                $scope.auto = false;
                $scope.resolve();
            }
        })
    }

    // Manual Resolve
    
    $scope.resolve = function() {

        $scope.index = 0;
        $scope.pending = null;

        MediaService.getPending(function(err, res) {

            if (res) {

                $scope.pending = res;
                $scope.pending.working = false;

                if ($scope.pending.type == 'movie') {

                    APIService.get().searchMovie({ query: $scope.pending.local.title, language: lang }, function(err, res) {
                        $scope.pending.sugestions = res.results;
                        $scope.$apply();
                    });
                }
                else if ($scope.pending.type == 'tvshow') {
                    APIService.get().searchTv({ query: $scope.pending.local.name, language: lang }, function(err, res) {
                        $scope.pending.sugestions = res.results;
                        $scope.$apply();
                    });
                }
            }
            else {
                $scope.pending = null;
                $scope.$apply();
            }
        })
    }

    $scope.showSearch = function() {
        $scope.pending.sugestions = [];
    }

    $scope.reSearch = function(type) {

        var callback = function(err, res) {
            $scope.pending.sugestions = res.results;
            $scope.otherName = '';
            $scope.index = 0;
            $scope.$apply();
        };

        if (type == 'movie') APIService.get().searchMovie({ query: $scope.otherName, language: lang }, callback);
        else if (type == 'tvshow') APIService.get().searchTv({ query: $scope.otherName, language: lang }, callback);
        else console.log('Error: no-type');
    }

    $scope.prevSugestion = function() { $scope.index-- }
    $scope.nextSugestion = function() { $scope.index++ }
});

//------------------------------------------------------------------------------
//  Spider Controller
//------------------------------------------------------------------------------

mediaLibrary.controller('moviesController', function($scope, MediaService) {

    // Movies
    
    MediaService.getResolved('movie', function(err, res) {
        if (!err) {
            $scope.movies = res;
            $scope.$apply();
        }
        else {
            console.log(err);
        }
    });
});