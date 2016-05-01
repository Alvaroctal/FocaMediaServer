var mediaLibrary = angular.module('MediaLibrary', ['file-model']);

//------------------------------------------------------------------------------
//  Directories Service
//------------------------------------------------------------------------------

mediaLibrary.factory('DirectoriesService', function () {

    var directories = config.getDirectories();
    if (!directories) directories = { 'movies': {}, 'tvshows': {} };

    return {
        getDirectories: function (media) {
            return directories[media];
        },
        addDirectory: function (media, path, timestamp) {
            directories[media][path] = timestamp;
            config.setDirectories(directories);
        },
        removeDirectory: function (media, path) {
            delete directories[media][path];
            config.setDirectories(directories);
        }
    };
});

//------------------------------------------------------------------------------
//  Media Service
//------------------------------------------------------------------------------

var Datastore = require('nedb');  
var db = new Datastore({ filename: path.join(process.cwd(), 'data', 'db.json'), autoload: true });

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
        getMoviesResolved: function() {
            return mediaCollection.find({type: 'movie',data:{$exists:true}}).rows;
        }
    }
});

//------------------------------------------------------------------------------
//  API Service
//------------------------------------------------------------------------------

mediaLibrary.factory('APIService', function($q) {
    var api = [];

    if (config.getApiKey()) {
        api = require('moviedb')(config.getApiKey());
        api.session_id = config.getSessionID();

        var def = $q.defer();

        if (api.session_id) {
            api.accountInfo(function(err, res) {
                if (! err) def.resolve(res);
                else def.reject(err);
            });
        }

        api['account'] = def.promise;
    }

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
});

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
});

//------------------------------------------------------------------------------
//  Account Controller
//------------------------------------------------------------------------------

mediaLibrary.controller('accountController', function($scope, APIService) {

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
                
                config.setApiKey(APIService.get().api_key);

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

        APIService.get().session(function(err, res) {
            if (! err) {

                config.setSessionID(APIService.get().session_id);

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

    $scope.end = null;

    var autoResolveNotification = null;
    var autoResolveProgress = null;
    var delay = 300;
    var lang = 'es';

    $timeout( function(){ if ($scope.auto) $scope.autoResolve(); else $scope.getPending() }, 500);

    // Get Movie

    $scope.getMovie = function(id, callback) {
        APIService.get().movieInfo({id: id, language: lang, append_to_response: "videos,images"}, function(err, movie){
            MediaService.upsertData($scope.pending._id, (movie ? movie : -1));

            cachePoster(movie);
            $timeout(callback, delay);
        });
    }

    // Get TvShow

    $scope.getTvShow = function(id, callback) {
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
        try {
            var file = fs.createWriteStream(path.join(process.cwd(), 'data', 'mirror', 't', 'p', 'w92', media.poster_path));
            var request = https.get("https://image.tmdb.org/t/p/w92" + media.poster_path, function(response) {
                response.pipe(file);
            });
        } catch (e) {
            console.log(media);
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

        if ($scope.pending = MediaService.getPending()) {

            if ($scope.pending.type == 'movie') {

                APIService.get().searchMovie({ query: $scope.pending.local.title, language: lang }, function(err, res) {
                    $scope.pending.sugestions = res.results;
                    $scope.$apply();
                });
            }
            else if ($scope.pending.type == 'tvshow') {

            }
        }
        else {
            $scope.end = true;
        }
    }

    $scope.showSearch = function() {
        $scope.pending.sugestions = [];
    }

    $scope.reSearch = function() {
        APIService.get().searchMovie({ query: $scope.otherName, language: lang }, function(err, res) {
            $scope.pending.sugestions = res.results;
            $scope.otherName = '';
            $scope.index = 0;
            $scope.$apply();
        });
    }

    $scope.prevSugestion = function() { $scope.index-- }
    $scope.nextSugestion = function() { $scope.index++ }
});

//------------------------------------------------------------------------------
//  Spider Controller
//------------------------------------------------------------------------------

mediaLibrary.controller('moviesController', function($scope, MediaService) {

    // Movies
    
    $scope.movies = MediaService.getMoviesResolved();
});