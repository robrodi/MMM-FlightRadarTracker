'use strict';

const NodeHelper = require('node_helper');
const radar = require('flightradar24-client/lib/radar');
const geoutils = require('geolocation-utils');
const parse = require('csv-parse');
const fs = require('fs');
const path = require('path');

module.exports = NodeHelper.create({

    airlines: [],
    aircrafts: [],
	
    init: function() {

        const airlineParser = parse({
            delimiter: ',',
            columns: ['id', 'name', 'alias', 'iata', 'icao', 'callsign', 'country', 'active']
        });
        const aircraftsParser = parse({
            delimiter: ',',
            columns: ['icao', 'regid', 'mdl', 'type', 'operator']
        });

        fs.createReadStream(path.join(__dirname, 'data', 'airlines.csv'))
            .pipe(airlineParser)
            .on('error', err => {
                console.error(err);
            })
            .on('data', row => {
                Object.keys(row).forEach(key => {
                    if (row[key] === '\\N') {
                        row[key] = null
                    }
                });
                row.id = Number.parseInt(row.id, 10);
                row.active = row.active === 'Y';

                this.airlines.push(row);
            })
            .on('end', () => {
                console.log('Airlines DB loaded');
            });

        fs.createReadStream(path.join(__dirname, 'data', 'aircrafts.csv'))
            .pipe(aircraftsParser)
            .on('error', err => {
                console.error(err);
            })
            .on('data', row => {
                Object.keys(row).forEach(key => {
                    if (row[key] === '') {
                        row[key] = null
                    }
                });
                this.aircrafts.push(row);
            })
            .on('end', () => {
                console.log('Aircrafts DB loaded');
            });
    },

    socketNotificationReceived: function (notification, payload) {

        const self = this;

		if (notification === "MMM-FlightRadarTracker_UPDATE_DATA") {
			var boundingBox = geoutils.getBoundingBox([{ lat: payload.centerPoint[0], lon: payload.centerPoint[1] }], payload.distance * 1000);
			radar(boundingBox.topLeft.lat, boundingBox.topLeft.lon, boundingBox.bottomRight.lat, boundingBox.bottomRight.lon)
				.then(function (result) {
					self.trackAircrafts(payload.centerPoint[0], payload.centerPoint[1], payload.limit, result);
				})
				.catch(console.error);
		}
    },
	
    trackAircrafts: function(lat, lon, limit, data) {
        
		console.log(lat, lon);
		
		let aircrafts = data
            .filter(aircraft => aircraft.callsign)
            .map(aircraft => {

                const plane = aircraft.modeSCode ? this.aircrafts.find(plane => plane.icao === aircraft.modeSCode.toLowerCase()) : null;
                const airline = this.airlines.find(airline => airline.icao === aircraft.callsign.substr(0, 3));

                // Find out airline name
                if (!aircraft.hasOwnProperty('airline')) {
                    let airlineName = [];
                    if (airline) {
                        airlineName.push(airline.alias || airline.name);
                        if (!airline.active) {
                            airlineName.push('*');
                        }
                    } else {
                        airlineName.push('Unknown');
                    }
                    if (plane && plane.operator) {
                        airlineName = [plane.operator];
                    }
                    aircraft.airline = airlineName.join('');
                }

                // Find out plane type
                if (!aircraft.hasOwnProperty('type') && plane && plane.type) {
                    aircraft.type = plane.type;
                }

                // Find out plane distance and direction from base coordinates
                if (aircraft.latitude && aircraft.longitude) {
                    const R = 6371e3; // metres
                    const radLat1 = this.toRadians(lat);
                    const radLat2 = this.toRadians(aircraft.latitude);
                    const deltaLat = this.toRadians(aircraft.latitude - lat);
                    const deltaLng = this.toRadians(aircraft.longitude - lon);

                    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
                        Math.cos(radLat1) * Math.cos(radLat2) *
                        Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

                    aircraft.distance = R * c;

                    const y = Math.sin(deltaLng) * Math.cos(radLat2);
                    const x = Math.cos(radLat1) * Math.sin(radLat2) -
                        Math.sin(radLat1) * Math.cos(radLat2) * Math.cos(deltaLng);
                    const bearing = this.toDegree(Math.atan2(y, x));
                }

                return aircraft;
            });

        if (aircrafts.length > limit) {
            aircrafts = aircrafts.slice(0, limit);
        }

        this.sendSocketNotification('MMM-FlightRadarTracker_DATA_RECEIVED', aircrafts);
    },

    toRadians: function(n) {
        return n * Math.PI / 180;
    },

    toDegree: function(n) {
        return n * 180 / Math.PI;
    }
});