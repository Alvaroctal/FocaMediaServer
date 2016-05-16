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
            data = loadedData.directories ? loadedData : {'directories': {'movies': {}, 'tvshows': {}}};
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
            StorageService.set('directories', directories);
        },
        removeDirectory: function (media, path) {
            delete directories[media][path];
            StorageService.set('directories', directories);
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
        }
    }
});

//------------------------------------------------------------------------------
//  API Service
//------------------------------------------------------------------------------

mediaLibrary.factory('APIService', ['$q', 'StorageService', function($q, StorageService) {

    var api = [];

    StorageService.load().then(function() {
        if (StorageService.get('api_key')) {
            api = require('moviedb')(StorageService.get('api_key'));
            api.session_id = StorageService.get('session_id');

            var def = $q.defer();

            if (api.session_id) {
                api.accountInfo(function(err, res) {
                    if (! err) def.resolve(res);
                    else def.reject(err);
                });
            }

            api['account'] = def.promise;
        }
    });

    return {
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

mediaLibrary.controller('appController', function($scope, DirectoriesService, APIService){

    $scope.api = APIService.get();

    if ($scope.api.api_key) {
        $scope.api.account.then(function(data) {
            $scope.api.account = data;
        });
    }

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
    
    var http = require('http');
    var polo = require('polo');
    var port = 14123;
    var apps = polo({ monitor: true });

    var server = http.createServer(function(req, res) {

        var output = {};

        if (req.url === '/') output = { status: 1, action: 'status', data: 'everything looks fine here.' }
        else if (req.url == '/index') output = { status: 1, action: 'index', data: db.getAllData()}

        console.log(req.url);

        res.end(JSON.stringify(output));
    });

    server.listen(port, function() {

        apps.put({
            name: 'foca-media',
            port: port
        });
    });
});

//------------------------------------------------------------------------------
//  Account Controller
//------------------------------------------------------------------------------

mediaLibrary.controller('accountController', function($scope, APIService, StorageService) {

    // Account
    
    var clipboard = require('electron').clipboard;

    $scope.api = APIService.get();

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
            console.log(err);
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
    posterWidths.forEach(function(posterWidth) { mkdirp(path.join(userDataPath, 'mirror', 't', 'p', 'w' + posterWidth), function (err) { if (err) console.error(err) }) });

    $timeout( function(){ if ($scope.auto) $scope.autoResolve(); else $scope.getPending() }, 500);

    // Get Movie

    $scope.getMovie = function(id, callback) {

        if ($scope.pending) $scope.pending.working = true;

        APIService.get().movieInfo({id: id, language: lang, append_to_response: "videos,images"}, function(err, movie){
            MediaService.upsertData($scope.pending._id, (movie ? movie : -1));

            cachePoster(movie);
            $timeout(callback, delay);
        });
    }

    // Get TvShow

    $scope.getTvShow = function(id, callback) {

        if ($scope.pending) $scope.pending.working = true;

        APIService.get().tvInfo({id: id, language: lang, append_to_response: "videos,images"}, function(err, tvshow) {

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
        APIService.get().tvSeasonInfo({id: id, season_number: season_number, language: lang, append_to_response: "videos,images"}, function(err, season){
            MediaService.upsertData($scope.pending._id, (season ? season : -1));
            
            cachePoster(season);
            $timeout(function() { callback(season) }, delay);
        });
    }

    var cachePoster = function(media) {
        if (media.poster_path) {
            posterWidths.forEach(function(posterWidth) { 
                https.get("https://image.tmdb.org/t/p/w" + posterWidth + media.poster_path, function(response) {
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
                        icon: "<span class='mif-film'></span>",
                        keepOpen: true
                    });
                }
                else {
                    if (!autoResolveProgress) autoResolveProgress = $("#progress-resolve").data('progress');
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