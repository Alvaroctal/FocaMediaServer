/*
 *  Media Process Module
 *
 *  Author: Alvaro Octal
 *  Date: 02/04/2016
 */

module.exports = {
    patterns: {
        movie: /^([0-9a-zA-Zá-úü\(\)\.\- ]*) \(([0-9]*)\) \[([0-9]*)\] \[(Dual|Cast|VOSE)\]/,
        tvshowRegex: /^([0-9a-zA-Zá-úü\(\)\.\- ]*)$/,
        seasonRegex: /^([0-9a-zA-Zá-úü\(\)\.\- ]*) - (Temporada|Season) ([0-9]*) \(([0-9]*)\) - (SD|720|1080) \[(Cast|Dual|VOSE)\]$/,
        episodeRegex: /^([0-9a-zA-Zá-úÁ-Úü\(\)\.\- ]*) ([0-9]*)x([0-9]*) - ([0-9a-zA-Zá-úÁ-Úü\(\).,\-'&!¡_¿? ]*)\.([a-zA-Z0-0]*)$/
    },
    processMovie: function(fileName) {
        var movie = null;
        
        var match = this.patterns.movie.exec(fileName.normalize());
        if (match) {
            movie = { title: match[1], year: match[2], video: match[3], audio: match[4] }
        }

        return movie;
    },
    processTvShow: function(tvshowName) {
        var tvshow = null;
        
        var match = this.patterns.tvshowRegex.exec(tvshowName.normalize());
        if (match) {
            tvshow = {
                name: match[1]
            }
        }

        return tvshow;
    },
    processSeason: function(seasonName, tvshowName) {

        var season = null;
        
        var match = this.patterns.seasonRegex.exec(seasonName.normalize());
        if (match) {
            season = { tvshow: match[1], number: parseInt(match[3]), year: parseInt(match[4]), video: match[5], audio: match[6] }
            if (season.tvshow != tvshowName) episode = null;
        }

        return season;
    },
    processEpisode: function(episodeName, tvshowName) {

        var episode = null;
        
        var match = this.patterns.episodeRegex.exec(episodeName.normalize());
        if (match) {
            episode = { tvshow: match[1], season: parseInt(match[2]), number: parseInt(match[3]), name: match[4], ext: match[5] }
            if (episode.tvshow != tvshowName) episode = null;
        }

        return episode;
    }
}

return module.exports;