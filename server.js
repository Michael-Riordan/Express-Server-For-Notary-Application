const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const connection = require('./db');
const bcrypt = require('bcrypt');
const { error } = require('console');
const app = express();
const path = require('path');
const fs = require('fs');
const { isUtf8 } = require('buffer');
require('dotenv').config();
const port = 8000;
const businessHoursFilePath = path.join(__dirname, 'business-hours.json');
const blockedDatesFilePath = path.join(__dirname, 'blocked-dates.json');
const blockedTimesFilePath = path.join(__dirname, 'blocked-times-and-date.json')
const pendingAppointmentsFilePath = path.join(__dirname, 'pending-appointments.json');
app.use(express.static(path.dirname(businessHoursFilePath)));
app.use(express.static(path.dirname(blockedDatesFilePath)));
app.use(express.static(path.dirname(blockedTimesFilePath)));
app.use(express.static(path.dirname(pendingAppointmentsFilePath)));


function logger(req, res, next) { 
    console.log(`[${Date.now()}] ${req.method} ${req.url}`);
    next();
}

app.use(logger);

app.use(cors());

app.use(bodyParser.json());


app.get('/api/places', async (req, res) => {
    const apiKey = process.env.PLACES_API_KEY;
    try {
        const query = req.query.query;
        const response = await axios.get(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${query}&components=country:US&key=${apiKey}`)
        res.json(response.data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error'});
    }
});

app.get('/api/distance', async (req, res) => {
    const apiKey = process.env.PLACES_API_KEY;
    try {
        const destination = req.query.query;
        const response = await axios.get(`https://maps.googleapis.com/maps/api/directions/json?origin=${process.env.ADDRESS_ORIGIN}&destination=place_id:${destination}&key=${apiKey}`);
        res.json(response.data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Most likely cause being distance not yet set' });
    }
});

app.get('/appointments', (req, res) => {
    const APPOINTMENT_QUERY = "select * from notaryappointmentmanager.appointments"
    connection.query(APPOINTMENT_QUERY, (err, response) => {
        if (err) {
            console.log(err)
        } else {
            res.send(response);
        }
    })
})

app.post('/addAppointment', (req, res) => {
    const ADD_QUERY = `insert into notaryappointmentmanager.appointments (appointmentTime, appointmentDate) values ('${req.body.appointmentTime}', '${req.body.appointmentDate}')`
    connection.query(ADD_QUERY, (err) => {
        if (err) {
            console.log(err);
        } else {
            res.send('appointment added');
        }
    })
})

app.delete('/deleteAppointment/:appointmentId', (req, res) => {
    const DELETE_QUERY = `DELETE FROM notaryappointmentmanager.appointments where (appointmentId=${req.params.appointmentId})`;
    connection.query(DELETE_QUERY, (err, res) => {
        if (err) {
            console.log(req.params.appointmentId);
        } else {
            console.log(res);
        }
    });
});

app.post('/credentials', (req, res) => {
    const { username, password } = req.body;
    const CREDENTIALS_QUERY = `SELECT password FROM notaryappointmentmanager.credentials WHERE username = ?`;
    const selectParams = [username];
    connection.query(CREDENTIALS_QUERY, selectParams, (err, results) => {
        if (err) {
            console.error('Error querying the database:', error);
            return res.status(500).json({error: 'Internal server error'});
        }

        if (results.length === 0) {
            return res.status(401).json({error: 'Invalid credentials'});
        }

        const storedHashedPassword = results[0].password;
        bcrypt.compare(password, storedHashedPassword, (compareError, isMatch) => {
            if (compareError) {
                console.error('Error comparing passwords:', compareError);
                return res.status(500).json({ error: 'Internal Server Error'});
            }

            if (!isMatch) {
                return res.status(401).json({error: 'Invalid Credentials'});
            }

            return res.status(200).json({ message: 'Login Successful' });
        })
    });
});

app.get('/api/business-hours', (req, res) => {
    res.sendFile(businessHoursFilePath);
})

app.get('/api/blocked-dates', (req, res) => {
    res.sendFile(blockedDatesFilePath);
})

app.get('/api/blocked-time-for-date', (req, res) => {
    res.sendFile(blockedTimesFilePath);
})

app.get('/api/pending-appointments', (req, res) => {
    res.sendFile(pendingAppointmentsFilePath);
})

app.post('/update-hours', (req, res) => {
    const jsonHours = fs.readFileSync('./business-hours.json', 'utf8');
    const jsonArray = JSON.parse(jsonHours);
    const {day, time} = req.body;

    const targetObject = jsonArray.find(obj => obj.hasOwnProperty(day));

    targetObject[day].push(time);
    fs.writeFileSync('./business-hours.json', JSON.stringify(jsonArray));

    res.sendFile(businessHoursFilePath);
})

app.post('/delete-hours', (req, res) => {
    const jsonHours = fs.readFileSync('./business-hours.json', 'utf8');
    const jsonArray = JSON.parse(jsonHours);

    const {day, time} = req.body;

    const targetObject = jsonArray.find(obj => obj.hasOwnProperty(day));

    targetObject[day] = targetObject[day].filter(hour => hour !== time);

    fs.writeFileSync('./business-hours.json', JSON.stringify(jsonArray));

    res.sendFile(businessHoursFilePath);
})

app.post('/updateBlockedDates', (req, res) => {
    const { blockedDates } = req.body;
    const jsonDates = fs.readFileSync('./blocked-dates.json');
    const datesArray = JSON.parse(jsonDates);

    datesArray[0].Blocked = datesArray[0].Blocked.concat(blockedDates);
    fs.writeFileSync('./blocked-dates.json', JSON.stringify(datesArray));

    res.sendFile(blockedDatesFilePath);
})

app.post('/deleteSelectedDates', (req, res) => {
    const { blockedDates } = req.body;
    const jsonDates = fs.readFileSync('./blocked-dates.json');
    const datesArray = JSON.parse(jsonDates);

    datesArray[0].Blocked = datesArray[0].Blocked.filter(date => !blockedDates.includes(date));
    fs.writeFileSync('./blocked-dates.json', JSON.stringify(datesArray));

    res.sendFile(blockedDatesFilePath);
})

app.post('/updateBlockedTime', (req, res) => {
    const jsonTimes = fs.readFileSync('./blocked-times-and-date.json', 'utf8');
    const jsonTimesArray = JSON.parse(jsonTimes);

    jsonTimesArray.push(req.body)
    fs.writeFileSync('./blocked-times-and-date.json', JSON.stringify(jsonTimesArray));

    res.sendFile(blockedTimesFilePath);
})

app.post('/deleteBlockedTime', (req, res) => {
    const { date, time, buffer } = req.body;
    const jsonTimes = fs.readFileSync('./blocked-times-and-date.json', 'utf8');
    let jsonTimesArray = JSON.parse(jsonTimes);
    
    jsonTimesArray = jsonTimesArray.filter(obj => !(obj.date === date && obj.time === time && obj.buffer === buffer));

    fs.writeFileSync('./blocked-times-and-date.json', JSON.stringify(jsonTimesArray));

    res.sendFile(blockedTimesFilePath);   
})

app.post('/updatePendingAppointments', (req, res) => {
    const jsonAppointments = fs.readFileSync('./pending-appointments.json', 'utf8');
    const jsonAppointmentsArray = JSON.parse(jsonAppointments);

    jsonAppointmentsArray.push(req.body);
    fs.writeFileSync('./pending-appointments.json', JSON.stringify(jsonAppointmentsArray));
})

app.post('/removePendingAppointment', (req, res) => {
    const { name, appointment, appointmentId} = req.body;
    console.log(req.body);
    const jsonAppointments = fs.readFileSync('./pending-appointments.json', 'utf8');
    let jsonAppointmentsArray = JSON.parse(jsonAppointments);

    jsonAppointmentsArray = jsonAppointmentsArray.filter(obj => !(obj.name === name && obj.appointment === appointment && obj.appointmentId === appointmentId));

    /*fs.writeFileSync('./pending-appointments.json', JSON.stringify(jsonAppointmentsArray));

    res.sendFile(pendingAppointmentsFilePath);*/
})

/* EIA api call if needed in future. (tracks cost of gasoline in PADD 5 region)
app.get('/api/eia', async (req, res) => {
    const apiKey = process.env.EIA_API_KEY;
    try {
        const response = await axios.get(`https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${apiKey}&frequency=weekly&data[0]=value&facets[series][]=EMM_EPMRR_PTE_R5XCA_DPG&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=1`);
        res.json(response.data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});*/

app.listen(port, () => {
    console.log(`Server running on port ${port}`)
});

