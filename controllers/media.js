/*
 *  Media Process Module
 *
 *  Author: Alvaro Octal
 *  Date: 02/04/2016
 */

module.exports = {
    patterns: {
        movie: /^([0-9a-zA-Zá-úü\(\)\.\- ]*) \(([0-9]*)\) \[([0-9]*)\] \[(Dual|Cast|Vose)\]/
    },
    processMovie: function(fileName) {
        var movie = null;
        
        var match = this.patterns.movie.exec(fileName.normalize());
        if (match) {
            movie = {
                title: match[1],
                year: match[2],
                video: match[3],
                audio: match[4]
            }
        }

        return movie;
    }
}

return module.exports;