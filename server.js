const express = require('express');
const util = require('util');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const connectionPool = require('./db');
const bcrypt = require('bcrypt');
const { error } = require('console');
const app = express();
const path = require('path');
const fs = require('fs');
const { isUtf8 } = require('buffer');
require('dotenv').config();
const {S3Client, PutObjectCommand, GetObjectCommand} = require('@aws-sdk/client-s3');
const PORT = process.env.PORT || 8000;

app.use(cors({
    origin: 'https://lr-mobilenotary.com'
}));

function logger(req, res, next) { 
    console.log(`[${Date.now()}] ${req.method} ${req.url}`);
    next();
}

const queryAsync = (query, values) => {
    return new Promise((resolve, reject) => {
        connectionPool.query(query, values, (err, result) => {
            if (err) reject (err);
            else resolve(result);
        });
    });
};


app.use(logger);

app.use(bodyParser.json());

const s3Client = new S3Client({
    region: process.env.S3_BUCKET_REGION,
    credentials: {
        accessKeyId: process.env.ACCESS_KEY_ID,
        secretAccessKey: process.env.SECRET_ACCESS_KEY,
    },
});

async function getFileFromS3(bucketName, key) {
    const params = {
        Bucket: bucketName,
        Key: key,
    };

    try {
        const data = await s3Client.send(new GetObjectCommand(params));
        /* 
            data variable is an 'IncomingMessage' object - data.Body is a readable stream of response data.
            The stream is sent in data chunks;
            The chunks are read and concatenated into a string (JSON file contents) and converted to string;
            chunks array is then parsed and returned to client as JSON;
        */

        const body = await new Promise((resolve, reject) => {
            const chunks = [];
            data.Body.on('data', (chunk) => chunks.push(chunk));
            data.Body.on('end', () => resolve(Buffer.concat(chunks).toString()));
            data.Body.on('error', reject);
        });
        return JSON.parse(body);
    } catch (err) {
        console.error('Error fetching JSON file from S3:', err);
        throw err;
    };
};


app.get('/', (req, res) => {
    res.send('Default Route');
})

app.get('/api/places', async (req, res) => {
    const apiKey = process.env.PLACES_API_KEY;
    try {
        const query = req.query.query;
        const response = await axios.get(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${query}&location=33.5387%2C-112.1860&radius=49000&strictbounds=true&components=country:US&key=${apiKey}`)
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

let deleting = false;

app.delete('/deleteAppointment/:appointmentId', async (req, res) => {
    deleting = true;
    console.log('delete query called');
    try {
        const DELETE_QUERY = `DELETE FROM notaryappointmentmanager.appointments where (appointmentId=${req.params.appointmentId})`;
        const result = await queryAsync(DELETE_QUERY);

        if (result.affectedRows > 0) {
            res.status(200).json({ message: 'Appointment deleted successfully' });
        } else {
            res.status(404).json({ error: 'Appointment not found' });
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
    deleting = false;
});

app.get('/appointments', async (req, res) => {
    console.log('appointment query called');
    if (deleting === false) {
        try {
            const APPOINTMENT_QUERY = "select * from notaryappointmentmanager.appointments"
            const response = await queryAsync(APPOINTMENT_QUERY);
            res.send(response);
        } catch (error) {
            console.error('Error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        };
    };
})

app.post('/addAppointment', (req, res) => {
    const ADD_QUERY = `insert into notaryappointmentmanager.appointments (appointmentTime, appointmentDate) values ('${req.body.appointmentTime}', '${req.body.appointmentDate}')`
    connectionPool.query(ADD_QUERY, (err) => {
        if (err) {
            console.log(err);
        } else {
            res.send('appointment added');
        }
    })
})


app.put('/updateAppointment/:appointmentId', (req, res) => {
    const appointmentId = req.params.appointmentId;
    const newStatus = req.body.status;
    console.log(req.body.status, req.body.appointmentId);

    const updateQuery = 'UPDATE appointments SET status = ? WHERE appointmentid = ?';

    connectionPool.query(updateQuery, [newStatus, appointmentId], (err, results) => {
        if (err) {
            console.error('Error updating appointment status:', err);
            res.status(500).json({message: 'An error occurred while updating the appointment status.'})
            return;
        }

        if (results.affectedRows === 0) {
            res.status(404).json({message: 'Appointment not found or no changes made'});
        } else {
            res.status(200).json({message: 'Appointment status updated successfully.'})
        }
    });
});

app.post('/credentials', (req, res) => {
    const { username, password } = req.body;
    const CREDENTIALS_QUERY = `SELECT password FROM notaryappointmentmanager.credentials WHERE username = ?`;
    const selectParams = [username];
    connectionPool.query(CREDENTIALS_QUERY, selectParams, (err, results) => {
        if (err) {
            console.error('Error querying the database:', err);
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
    const bucketName = process.env.S3_BUCKET_NAME;
    const businessHoursFilePath = process.env.BUSINESS_HOURS_FILE_PATH;

    getFileFromS3(bucketName, businessHoursFilePath)
        .then((fileContent) => {
            res.set('Content-Type', 'application/json');
            res.send(fileContent);
        })
        .catch((err) => {
            console.error('Error fetching business hours from S3:', err);
            res.status(500).json({ error: 'Failed to fetch business hours' });
        });
})

app.get('/api/blocked-dates', (req, res) => {
    const bucketName = process.env.S3_BUCKET_NAME;
    const blockedDatesFilePath = process.env.BLOCKED_DATES_FILE_PATH;

    getFileFromS3(bucketName, blockedDatesFilePath)
        .then((fileContent) => {
            res.set('Content-Type', 'application/json');
            res.send(fileContent);
        })
        .catch((err) => {
            console.error('Error fetching blocked dates from S3:', err);
            res.status(500).json({ error: 'Failed to fetch blocked dates' });
        });
})

app.get('/api/blocked-time-for-date', (req, res) => {
    const bucketName = process.env.S3_BUCKET_NAME;
    const blockedTimesFilePath = process.env.BLOCKED_TIMES_FILE_PATH;

    getFileFromS3(bucketName, blockedTimesFilePath)
        .then((fileContent) => {
            res.set('Content-Type', 'application/json');
            res.send(fileContent);
        })
        .catch((err) => {
            console.error('Error fetching blocked times from S3:', err);
            res.status(500).json({ error: 'Failed to fetch blocked times' });
        });
})

app.get('/api/pending-appointments', (req, res) => {
    const bucketName = process.env.S3_BUCKET_NAME;
    const pendingAppointmentsFilePath = process.env.PENDING_APPOINTMENTS_FILE_PATH;

    getFileFromS3(bucketName, pendingAppointmentsFilePath)
        .then((fileContent) => {
            res.set('Content-Type', 'application/json');
            res.send(fileContent);
        })
        .catch((err) => {
            console.error('Error fetching pending-appointments from S3:', err);
            res.status(500).json({ error: 'Failed to fetch pending appointments' });
        });
})

app.post('/update-hours', async (req, res) => {
    const bucketName = process.env.S3_BUCKET_NAME;
    const key = process.env.BUSINESS_HOURS_FILE_PATH;
    try {
        const jsonArray = await getFileFromS3(bucketName, key);

        const {day, time} = req.body;

        const targetObject = jsonArray.find((obj) => obj.hasOwnProperty(day));

        targetObject[day].push(time);

        const uploadParams = {
            Bucket: bucketName,
            Key: key,
            Body: JSON.stringify(jsonArray),
        }

        await s3Client.send(new PutObjectCommand(uploadParams));

        res.json(jsonArray);
    } catch (err) {
        console.error('Error updating business hours:', err);
        res.status(500).json({error: 'Error updating business hours.'})
    }
});

app.post('/delete-hours', async (req, res) => {
    const bucketName = process.env.S3_BUCKET_NAME;
    const key = process.env.BUSINESS_HOURS_FILE_PATH
    try {
        const jsonArray = await getFileFromS3(bucketName, key);
        console.log(jsonArray);

        const {day, time} = req.body;

        const targetObject = jsonArray.find((obj) => obj.hasOwnProperty(day));

        targetObject[day] = targetObject[day].filter((hour) => hour !== time);

        const uploadParams = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: process.env.BUSINESS_HOURS_FILE_PATH,
            Body: JSON.stringify(jsonArray),
        }

        await s3Client.send(new PutObjectCommand(uploadParams));

        res.json(jsonArray);
    } catch (err) {
        console.error('Error updating business hours:', err);
        res.status(500).json({error: 'Error updating business hours.'});
    };
})

app.post('/updateBlockedDates', async (req, res) => {
    const bucketName = process.env.S3_BUCKET_NAME;
    const key = process.env.BLOCKED_DATES_FILE_PATH;

    try {
      const { blockedDates } = req.body;
      const datesArray = await getFileFromS3(bucketName, key);
  
      datesArray[0].Blocked = datesArray[0].Blocked.concat(blockedDates);
  
      const uploadParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: process.env.BLOCKED_DATES_FILE_PATH,
        Body: JSON.stringify(datesArray),
      };
  
      await s3Client.send(new PutObjectCommand(uploadParams));
  
      res.json(datesArray);
    } catch (err) {
      console.error('Error updating blocked dates:', err);
      res.status(500).json({ error: 'Error updating blocked dates.' });
    }
});

app.post('/deleteSelectedDates', async (req, res) => {
    const bucketName = process.env.S3_BUCKET_NAME;
    const key = process.env.BLOCKED_DATES_FILE_PATH;

    try {
      const { blockedDates } = req.body;
      const datesArray = await getFileFromS3(bucketName, key);
  
      datesArray[0].Blocked = datesArray[0].Blocked.filter(date => !blockedDates.includes(date));

      const uploadParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: process.env.BLOCKED_DATES_FILE_PATH,
        Body: JSON.stringify(datesArray),
      };
  
      await s3Client.send(new PutObjectCommand(uploadParams));
  
      res.json(datesArray);
    } catch (err) {
      console.error('Error deleting selected dates:', err);
      res.status(500).json({ error: 'Error deleting selected dates.' });
    }
});

app.post('/updateBlockedTime', async (req, res) => {
    const bucketName = process.env.S3_BUCKET_NAME;
    const key = process.env.BLOCKED_TIMES_FILE_PATH;

    try {
        getFileFromS3(bucketName, key)
            .then((fileContent) => {
                const jsonArray = fileContent;
                console.log(jsonArray);
            })
    
        jsonTimesArray.push(req.body);

        const uploadParams = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: process.env.BLOCKED_TIMES_FILE_PATH,
          Body: JSON.stringify(jsonTimesArray),
        };
    
        await s3Client.send(new PutObjectCommand(uploadParams));
        res.json(jsonTimesArray);
    } catch (err) {
        console.error('Error updating blocked times for date:', err);
        res.status(500).json({ error: 'Error updating blocked times for date.'})
    }
});

app.post('/deleteBlockedTime', async (req, res) => {
    const bucketName = process.env.S3_BUCKET_NAME;
    const key = process.env.BLOCKED_TIMES_FILE_PATH;

    try {
      const { date, time, buffer } = req.body;
      let jsonTimesArray = await getFileFromS3(bucketName, key);
  
      jsonTimesArray = jsonTimesArray.filter(obj => !(obj.date === date && obj.time === time && obj.buffer === buffer));
  
      const uploadParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: process.env.BLOCKED_TIMES_FILE_PATH,
        Body: JSON.stringify(jsonTimesArray),
      };
  
      await s3Client.send(new PutObjectCommand(uploadParams));
  
      res.json(jsonTimesArray);
    } catch (err) {
      console.error('Error deleting blocked time:', err);
      res.status(500).json({ error: 'Error deleting blocked time.' });
    }
});
  

app.post('/updatePendingAppointments', async (req, res) => {
    const bucketName = process.env.S3_BUCKET_NAME;
    const key = process.env.PENDING_APPOINTMENTS_FILE_PATH;

    try {
      const jsonAppointmentsArray = await getFileFromS3(bucketName, key);
  
      const existingAppointment = jsonAppointmentsArray.find(
        (appointment) => appointment.appointmentId === req.body.appointmentId
      );
  
      if (existingAppointment) {
        console.log('exists');
        return res.json({ message: 'Appointment already exists.' });
      } else {
        jsonAppointmentsArray.push(req.body);

        const uploadParams = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: process.env.PENDING_APPOINTMENTS_FILE_PATH,
          Body: JSON.stringify(jsonAppointmentsArray),
        };
  
        await s3Client.send(new PutObjectCommand(uploadParams));
      }
  
      res.json(jsonAppointmentsArray);
    } catch (err) {
      console.error('Error updating appointment:', err);
      res.status(500).json({ error: 'Error updating appointment.' });
    }
  });

app.post('/removePendingAppointment', async (req, res) => {
    const bucketName = process.env.S3_BUCKET_NAME;
    const key = process.env.PENDING_APPOINTMENTS_FILE_PATH;

    try {
      const { appointmentId } = req.body;
      let jsonAppointmentsArray = await getFileFromS3(bucketName, key);
  
      jsonAppointmentsArray = jsonAppointmentsArray.filter(
        (obj) => obj.appointmentId !== appointmentId
      );
  
      const uploadParams = {
        Bucket: bucketName,
        Key: key,
        Body: JSON.stringify(jsonAppointmentsArray),
      };
  
      await s3Client.send(new PutObjectCommand(uploadParams));
  
      res.json(jsonAppointmentsArray);
    } catch (err) {
      console.error('Error removing pending appointment:', err);
      res.status(500).json({ error: 'Error removing pending appointment.' });
    }
});
/*

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

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
});

