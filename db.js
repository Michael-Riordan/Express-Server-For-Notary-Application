const mysql = require('mysql2');
require('dotenv').config();

const connectionPool = mysql.createPool({
    connectionLimit: 5,
    host: `${process.env.PROXIMO_URL}`,
    user: `${process.env.RDS_USERNAME}`,
    password: `${process.env.MYSQL_PASSWORD}`,
    database: 'notaryappointmentmanager',
});

module.exports = connectionPool;