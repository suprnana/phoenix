/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2013 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

// @INCLUDE_IN_API_DOCS


define(function (require, exports, module) {


    var FileSystemEntry = require("filesystem/FileSystemEntry");


    /**
     * Model for a File.
     *
     * This class should *not* be instantiated directly. Use FileSystem.getFileForPath,
     * FileSystem.resolve, or Directory.getContents to create an instance of this class.
     *
     * See the FileSystem class for more details.
     *
     * @constructor
     * @param {!string} fullPath The full path for this File.
     * @param {!FileSystem} fileSystem The file system associated with this File.
     */
    function File(fullPath, fileSystem) {
        this._isFile = true;
        FileSystemEntry.call(this, fullPath, fileSystem);
    }

    File.prototype = Object.create(FileSystemEntry.prototype);
    File.prototype.constructor = File;
    File.prototype.parentClass = FileSystemEntry.prototype;

    /**
     * Cached contents of this file. This value is nullable but should NOT be undefined.
     * @private
     * @type {?string}
     */
    File.prototype._contents = null;


    /**
     * Encoding detected by brackets-shell
     * @private
     * @type {?string}
     */
    File.prototype._encoding = null;

    /**
     * BOM detected by brackets-shell
     * @private
     * @type {?bool}
     */
    File.prototype._preserveBOM = false;

    /**
     * Consistency hash for this file. Reads and writes update this value, and
     * writes confirm the hash before overwriting existing files. The type of
     * this object is dependent on the FileSystemImpl; the only constraint is
     * that === can be used as an equality relation on hashes.
     * @private
     * @type {?object}
     */
    File.prototype._hash = null;

    /**
     * Clear any cached data for this file. Note that this explicitly does NOT
     * clear the file's hash.
     * @private
     */
    File.prototype._clearCachedData = function () {
        FileSystemEntry.prototype._clearCachedData.apply(this);
        this._contents = null;
    };

    /**
     * Read a file.
     *
     * @param {Object} options
     * @param {string} [options.encoding] 'one of format supported here:
     *        https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/encoding'
     * @param {boolean} [options.ignoreFileSizeLimits] by default max file size that can be read is 16MB.
     * @param {boolean} [options.doNotCache] will not cache if enabled. Auto-enabled if ignoreFileSizeLimits = true
     *
     * @param {function (?string, string=, FileSystemStats=)} callback Callback that is passed the
     *              FileSystemError string or the file's contents and its stats.
     */
    File.prototype.read = function (options, callback) {
        if (typeof (options) === "function") {
            callback = options;
            options = {};
            options.encoding = this._encoding;
        }
        options.encoding = options.encoding || this._encoding || "utf8";
        if(options.ignoreFileSizeLimits) {
            options.doNotCache = true;
        }

        // We don't need to check isWatched() here because contents are only saved
        // for watched files. Note that we need to explicitly test this._contents
        // for a default value; otherwise it could be the empty string, which is
        // falsey.
        if (this._contents !== null && this._stat && options.encoding === this._encoding && !options.bypassCache) {
            callback(null, this._contents, this._encoding, this._stat);
            return;
        }

        var watched = this._isWatched();
        if (watched) {
            options.stat = this._stat;
        }

        this._impl.readFile(this._path, options, function (err, data, encoding, preserveBOM, stat) {
            if (err) {
                if(!options.doNotCache){
                    this._clearCachedData();
                }
                callback(err);
                return;
            }

            if(!options.doNotCache) {
                // Always store the hash
                this._hash = stat._hash;
                this._encoding = encoding;
                this._preserveBOM = preserveBOM;

                // Only cache data for watched files
                if (watched) {
                    this._stat = stat;
                    this._contents = data;
                }
            }

            callback(err, data, encoding, stat);
        }.bind(this));
    };

    function _insertIfNotPresent(addedList, file) {
        if(!addedList || !addedList.length) {
            return [file];
        }
        const foundEntry = addedList.find(entry => entry.fullPath === file.fullPath);
        if(!foundEntry){
            addedList.push(file);
        }
        return addedList;
    }

    /**
     * Write a file.
     *
     * @param {string} data Data to write.
     * @param {Object=} options properties \{encoding: 'one of format supported here:
     * https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/encoding'}
     * @param {function (?string, FileSystemStats=)=} callback Callback that is passed the
     *              FileSystemError string or the file's new stats.
     */
    File.prototype.write = function (data, options, callback) {
        if (typeof options === "function") {
            callback = options;
            options = {};
        } else {
            if (options === undefined) {
                options = {};
            }

            callback = callback || function () {};
        }

        // Request a consistency check if the write is not blind
        if (!options.blind) {
            options.expectedHash = this._hash;
            options.expectedContents = this._contents;
        }
        if (!options.encoding) {
            options.encoding = this._encoding || "utf8";
        }
        options.preserveBOM = this._preserveBOM;

        // Block external change events until after the write has finished
        this._fileSystem._beginChange();

        this._impl.writeFile(this._path, data, options, function (err, stat, created) {
            if (err) {
                this._clearCachedData();
                try {
                    callback(err);
                } finally {
                    // Always unblock external change events
                    this._fileSystem._endChange();
                }
                return;
            }

            // Always store the hash
            this._hash = stat._hash;

            // Only cache data for watched files
            if (this._isWatched()) {
                this._stat = stat;
                this._contents = data;
            }

            if (created) {
                var parent = this._fileSystem.getDirectoryForPath(this.parentPath);
                this._fileSystem._handleDirectoryChange(parent, function (added, removed) {
                    try {
                        // Notify the caller
                        callback(null, stat);
                    } finally {
                        if (parent._isWatched()) {
                            // If the write succeeded and the parent directory is watched,
                            // fire a synthetic change event
                            added = _insertIfNotPresent(added, this);
                            this._fileSystem._fireChangeEvent(parent, added, removed);

                        }
                        // Always unblock external change events
                        this._fileSystem._endChange();
                    }
                }.bind(this));
            } else {
                try {
                    // Notify the caller
                    callback(null, stat);
                } finally {
                    // existing file modified
                    this._fileSystem._fireChangeEvent(this);

                    // Always unblock external change events
                    this._fileSystem._endChange();
                }
            }
        }.bind(this));
    };

    // Export this class
    module.exports = File;
});
