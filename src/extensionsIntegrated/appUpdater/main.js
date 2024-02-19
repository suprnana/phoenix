define(function (require, exports, module) {
    const AppInit = require("utils/AppInit"),
        Commands = require("command/Commands"),
        CommandManager  = require("command/CommandManager"),
        Menus = require("command/Menus"),
        Dialogs = require("widgets/Dialogs"),
        NodeUtils = require("utils/NodeUtils"),
        DefaultDialogs  = require("widgets/DefaultDialogs"),
        Strings     = require("strings"),
        marked = require('thirdparty/marked.min'),
        semver = require("thirdparty/semver.browser"),
        TaskManager = require("features/TaskManager"),
        PreferencesManager  = require("preferences/PreferencesManager");
    let updaterWindow, updateTask, updatePendingRestart;

    const TAURI_UPDATER_WINDOW_LABEL = "updater",
        KEY_LAST_UPDATE_CHECK_TIME = "PH_LAST_UPDATE_CHECK_TIME",
        KEY_UPDATE_AVAILABLE = "PH_UPDATE_AVAILABLE";

    function showOrHideUpdateIcon() {
        if(!updaterWindow){
            updaterWindow = window.__TAURI__.window.WebviewWindow.getByLabel(TAURI_UPDATER_WINDOW_LABEL);
        }
        if(updaterWindow && !updateTask) {
            updateTask = TaskManager.addNewTask(Strings.UPDATING_APP, Strings.UPDATING_APP_MESSAGE,
                `<i class="fa-solid fa-cogs"></i>`, {
                    onSelect: function () {
                        if(updatePendingRestart){
                            Dialogs.showInfoDialog(Strings.UPDATE_READY_RESTART_TITLE, Strings.UPDATE_READY_RESTART_MESSAGE);
                        } else {
                            Dialogs.showInfoDialog(Strings.UPDATING_APP, Strings.UPDATING_APP_DIALOG_MESSAGE);
                        }
                    }
                });
        }
        let updateAvailable = PreferencesManager.getViewState(KEY_UPDATE_AVAILABLE);
        if(updateAvailable){
            $("#update-notification").removeClass("forced-hidden");
        } else {
            $("#update-notification").addClass("forced-hidden");
        }
    }

    function fetchJSON(url) {
        return fetch(url)
            .then(response => {
                if (!response.ok) {
                    return null;
                }
                return response.json();
            });
    }

    function createTauriUpdateWindow() {
        if(updaterWindow){
            return;
        }
        // as we are a single instance app, and there can be multiple phoenix windows that comes in and goes out,
        // the updater lives in its own independent hidden window.
        updaterWindow = new window.__TAURI__.window.WebviewWindow(TAURI_UPDATER_WINDOW_LABEL, {
            url: "tauri-updater.html",
            title: "Desktop App Updater",
            fullscreen: false,
            resizable: false,
            height: 320,
            minHeight: 320,
            width: 240,
            minWidth: 240,
            acceptFirstMouse: false,
            visible: false
        });
    }

    async function doUpdate() {
        createTauriUpdateWindow();
        showOrHideUpdateIcon();
    }

    async function getUpdatePlatformKey() {
        const platformArch = await Phoenix.app.getPlatformArch();
        let os = 'windows';
        if (brackets.platform === "mac") {
            os = "darwin";
        } else if (brackets.platform === "linux") {
            os = "linux";
        }
        return `${os}-${platformArch}`;
    }

    async function getUpdateDetails() {
        const updatePlatformKey = await getUpdatePlatformKey();
        const updateDetails = {
            shouldUpdate: false,
            updatePendingRestart: false,
            downloadURL: null,
            currentVersion: Phoenix.metadata.apiVersion,
            updateVersion: null,
            releaseNotesMarkdown: null,
            updatePlatform: updatePlatformKey
        };
        try{
            const updateMetadata = await fetchJSON(brackets.config.app_update_url);
            const phoenixBinaryVersion = await NodeUtils.getPhoenixBinaryVersion();
            const phoenixLoadedAppVersion = Phoenix.metadata.apiVersion;
            if(semver.gt(updateMetadata.version, phoenixBinaryVersion)){
                console.log("Update available: ", updateMetadata, "Detected platform: ", updatePlatformKey);
                PreferencesManager.setViewState(KEY_UPDATE_AVAILABLE, true);
                updateDetails.shouldUpdate = true;
                updateDetails.updateVersion = updateMetadata.version;
                updateDetails.releaseNotesMarkdown = updateMetadata.notes;
                if(updateMetadata.platforms && updateMetadata.platforms[updatePlatformKey]){
                    updateDetails.downloadURL = updateMetadata.platforms[updatePlatformKey].url;
                }
            } else if(semver.eq(updateMetadata.version, phoenixBinaryVersion) &&
                !semver.eq(phoenixLoadedAppVersion, phoenixBinaryVersion)){
                console.log("Updates applied, waiting for app restart: ", phoenixBinaryVersion, phoenixLoadedAppVersion);
                updateDetails.updatePendingRestart = true;
                PreferencesManager.setViewState(KEY_UPDATE_AVAILABLE, true);
            } else {
                console.log("no updates available for platform: ", updateDetails.updatePlatform);
                PreferencesManager.setViewState(KEY_UPDATE_AVAILABLE, false);
            }
            showOrHideUpdateIcon();
        } catch (e) {
            console.error("Error getting update metadata");
        }
        return updateDetails;
    }

    async function checkForUpdates(isAutoUpdate) {
        showOrHideUpdateIcon();
        if(updateTask){
            $("#status-tasks .btn-dropdown").click();
            return;
        }
        const updateDetails = await getUpdateDetails();
        if(updatePendingRestart || updateDetails.updatePendingRestart){
            (!isAutoUpdate) && Dialogs.showInfoDialog(Strings.UPDATE_READY_RESTART_TITLE, Strings.UPDATE_READY_RESTART_MESSAGE);
            return;
        }
        if(!updateDetails.shouldUpdate){
            (!isAutoUpdate) && Dialogs.showInfoDialog(Strings.UPDATE_NOT_AVAILABLE_TITLE, Strings.UPDATE_UP_TO_DATE);
            return;
        }
        const buttons = [
            { className: Dialogs .DIALOG_BTN_CLASS_NORMAL, id: Dialogs .DIALOG_BTN_CANCEL, text: Strings.UPDATE_LATER },
            { className: Dialogs .DIALOG_BTN_CLASS_PRIMARY, id: Dialogs .DIALOG_BTN_OK, text: Strings.GET_IT_NOW }
        ];
        let markdownHtml = marked.parse(updateDetails.releaseNotesMarkdown || "");
        Dialogs.showModalDialog(DefaultDialogs.DIALOG_ID_INFO, Strings.UPDATE_AVAILABLE_TITLE, markdownHtml, buttons)
            .done(option=>{
                if(option === Dialogs.DIALOG_BTN_OK && !updaterWindow){
                    doUpdate();
                }
            });
    }

    const UPDATE_COMMANDS = {
        GET_STATUS: "GET_STATUS"
    };
    const UPDATE_EVENT = {
        STATUS: "STATUS"
    };
    const UPDATE_STATUS = {
        STARTED: "STARTED"
    };

    function _sendUpdateCommand(command, data) {
        window.__TAURI__.event.emit('updateCommands', {command, data});
    }

    function _refreshUpdateStatus() {
        _sendUpdateCommand(UPDATE_COMMANDS.GET_STATUS);
    }

    AppInit.appReady(function () {
        if(!Phoenix.browser.isTauri || Phoenix.isTestWindow) {
            // app updates are only for desktop builds
            return;
        }
        updaterWindow = window.__TAURI__.window.WebviewWindow.getByLabel(TAURI_UPDATER_WINDOW_LABEL);
        window.__TAURI__.event.listen("updater-event", (receivedEvent)=> {
            console.log("received Event updater-event", receivedEvent);
            const {eventName, data} = receivedEvent.payload;
            if(eventName === UPDATE_EVENT.STATUS) {
                showOrHideUpdateIcon();
            }
        });
        $("#update-notification").click(()=>{
            checkForUpdates();
        });
        const commandID = Commands.HELP_CHECK_UPDATES || "help.checkUpdates";// todo remove this line after dev
        CommandManager.register(Strings.CMD_CHECK_FOR_UPDATE, commandID, ()=>{
            checkForUpdates();
        });
        const helpMenu = Menus.getMenu(Menus.AppMenuBar.HELP_MENU);
        helpMenu.addMenuItem(commandID, "", Menus.AFTER, Commands.HELP_GET_INVOLVED);
        showOrHideUpdateIcon();
        _refreshUpdateStatus();
        // check for updates at boot
        let lastUpdateCheckTime = PreferencesManager.getViewState(KEY_LAST_UPDATE_CHECK_TIME);
        if(!lastUpdateCheckTime){
            lastUpdateCheckTime = Date.now();
            PreferencesManager.setViewState(KEY_LAST_UPDATE_CHECK_TIME, lastUpdateCheckTime);
        }
        const currentTime = Date.now();
        const oneDayInMilliseconds = 24 * 60 * 60 * 1000; // 24 hours * 60 minutes * 60 seconds * 1000 milliseconds
        if ((currentTime - lastUpdateCheckTime) < oneDayInMilliseconds) {
            console.log("Skipping update check: last update check was within one day");
            return;
        }
        checkForUpdates(true);
    });
});
