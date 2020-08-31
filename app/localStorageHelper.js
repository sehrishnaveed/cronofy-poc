let localStorage;
if (typeof localStorage === "undefined" || localStorage === null) {
    var LocalStorage = require('node-localstorage').LocalStorage;
    localStorage = new LocalStorage('./scratch');
}

function setAuthTokenInfo(authToken) {
    localStorage.setItem('auth_token_detail', JSON.stringify(authToken));
}

function removeAuthTokenInfo() {
    localStorage.removeItem('auth_token_detail');
}

function getAuthTokenInfo() {
    return JSON.parse(localStorage.getItem('auth_token_detail'));
}

function getAccessToken() {
    const authDetail = JSON.parse(localStorage.getItem('auth_token_detail'));
    return authDetail.access_token;
}

function setCalendarsList(calendarInfo) {
    localStorage.setItem('calendar_info', JSON.stringify(calendarInfo));
}

function removeCalendarsList() {
    localStorage.removeItem('calendar_info');
}

function getFirstCalendarId() {
    const calendarInfo = JSON.parse(localStorage.getItem('calendar_info'));
    if (calendarInfo && calendarInfo.length > 0) {
        return calendarInfo[0].calendar_id;
    }
    return null;
}

module.exports = {
    removeAuthTokenInfo,
    removeCalendarsList,
    setAuthTokenInfo,
    getAuthTokenInfo,
    getAccessToken,
    setCalendarsList,
    getFirstCalendarId,
};