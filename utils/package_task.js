'use strict';

var path = require('path');
var npm = require("npm");
var archive = require('archiver');
var fs = require('fs');
var tmp = require('temporary');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var dateFacade = require('./date_facade');

var packageTask = {};

packageTask.getHandler = function (grunt) {

    return function () {
        var task = this;

        var options = this.options({
            'dist_folder': 'dist',
            'include_time': false,
            'include_version': false,
            'include_files': '**/*',
            'base_folder': './',
            'exclude_aws_sdk': true
        });

        var pkg = JSON.parse(fs.readFileSync(path.resolve('./package.json'), "utf8"));
        
        var dir = new tmp.Dir();
        var done = this.async();

        var archive_name = pkg.name;

        if (options.include_time) {
            archive_name += '-' + dateFacade.getFormattedTimestamp(new Date());
        }

        if (options.include_version) {
            archive_name += '-' + pkg.version.replace(/\./g, '_');
        }
        
        npm.load({}, function (err, npm) {
                        
            npm.config.set('loglevel', 'silent');
            npm.config.set('production', true);
            npm.config.get('global', false)

            var install_location = dir.path;
            var zip_path = install_location + '/' + archive_name + '.zip';
            
            fs.copyFileSync('./package.json', install_location + '/package.json');
            
            try {
                fs.copyFileSync('./package-lock.json', install_location + '/package-lock.json');
            } catch (err) { }               
            
            if (options.exclude_aws_sdk) {
                var prefix = npm.prefix;
                npm.prefix = install_location;
                
                npm.commands.uninstall([install_location, 'aws-sdk'], function () {
                    npm.prefix = prefix;
                    packModules();                 
                });
            } else {
                packModules();
            }
            
            function packModules() { 
                          
                npm.commands.install(install_location, [], function () {
    
                    var output = fs.createWriteStream(zip_path);
                    var zipArchive = archive('zip');
    
                    var old_normalizeEntryData = zipArchive._normalizeEntryData;
                    zipArchive._normalizeEntryData = function (data, stats) {
                        // 0777 file permission
                        data.mode = 511;
                        return old_normalizeEntryData.apply(zipArchive, [data, stats]);
                    };
    
                    zipArchive.pipe(output);
                    
                    zipArchive.directory(install_location + '/node_modules/', 'node_modules');
                    
                    zipArchive.glob(options.include_files, { cwd: options.base_folder, dot: true });

                    zipArchive.finalize();
                    
                    output.on('error', function () {
                        done(new Error('Cannot write to the file: ' + zip_path));
                    });

                    output.on('close', function () {
                        mkdirp('./' + options.dist_folder, function () {
                            var dist_path = './' + options.dist_folder + '/' + archive_name + '.zip';
                            var dist_zip = fs.createWriteStream(dist_path);
                            fs.createReadStream(zip_path).pipe(dist_zip);

                            dist_zip.on('error', function () {
                                done(new Error('Cannot write to the file: ' + dist_path));
                            });

                            dist_zip.on('close', function () {
                                rimraf(install_location, function (err) {
                                    if (err) {
                                        done(new Error('Cannot clean the dir: ' + install_location));
                                    } else {
                                        grunt.log.writeln('Created package at ' + dist_path);
                                        done(true);
                                    }
                                });
                            });
                        });
                    });
                });
            } // packModules
        });
    };
};     

module.exports = packageTask;