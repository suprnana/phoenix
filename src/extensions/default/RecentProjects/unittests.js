/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2014 - 2021 Adobe Systems Incorporated. All rights reserved.
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

/*global describe, it, expect, beforeFirst, afterLast, runs, waitsFor, spyOn */

define(function (require, exports, module) {


    var SpecRunnerUtils = brackets.getModule("spec/SpecRunnerUtils"),
        FileUtils       = brackets.getModule("file/FileUtils"),
        KeyEvent        = brackets.getModule("utils/KeyEvent"),
        _               = brackets.getModule("thirdparty/lodash");

    describe("extension:Recent Projects", function () {
        var extensionPath = FileUtils.getNativeModuleDirectoryPath(module),
            testWindow,
            $,
            CommandManager,
            PreferencesManager;

        beforeFirst(function () {
            runs(function () {
                SpecRunnerUtils.createTestWindowAndRun(this, function (w) {
                    testWindow = w;
                    $ = testWindow.$;
                    CommandManager  = testWindow.brackets.test.CommandManager;
                    PreferencesManager = testWindow.brackets.test.PreferencesManager;
                });
            });
        });

        afterLast(function () {
            testWindow = null;
            SpecRunnerUtils.closeTestWindow();
        });

        function openRecentProjectDropDown() {
            CommandManager.execute("recentProjects.toggle");
            waitsFor(function () {
                return $("#project-dropdown").is(":visible");
            });
        }

        function setupRecentProjectsSpy(howManyProjects) {
            spyOn(PreferencesManager, "getViewState").andCallFake(function (prefId) {
                if (prefId === "recentProjects") {
                    // return howManyProjects number of fake recent projects entries
                    return _.map(_.range(1, howManyProjects + 1), function (num) { return extensionPath + "/Test-Project-" + num; });
                }
                return [];

            });
        }

        describe("UI", function () {
            it("should open the recent projects list with only the getting started project", function () {
                runs(function () {
                    openRecentProjectDropDown();
                });

                runs(function () {
                    var $dropDown = $("#project-dropdown");
                    expect($dropDown.children().length).toEqual(1);
                });
            });

            it("should open the recent project list and show 5 recent projects", function () {
                setupRecentProjectsSpy(5);

                runs(function () {
                    openRecentProjectDropDown();
                });

                runs(function () {
                    var $dropDown = $("#project-dropdown");
                    expect($dropDown.find(".recent-folder-link").length).toEqual(5);
                });
            });

            it("should delete one project from recent project list when delete key is pressed on", function () {
                setupRecentProjectsSpy(5);

                runs(function () {
                    openRecentProjectDropDown();
                });

                runs(function () {
                    var $dropDown = $("#project-dropdown");
                    SpecRunnerUtils.simulateKeyEvent(KeyEvent.DOM_VK_DOWN, "keydown", $dropDown[0]);
                    SpecRunnerUtils.simulateKeyEvent(KeyEvent.DOM_VK_DELETE, "keydown", $dropDown[0]);
                });

                runs(function () {
                    var $dropDown = $("#project-dropdown");
                    expect($dropDown.find(".recent-folder-link").length).toEqual(4);
                });
            });
        });
    });
});
