module.exports = {
  apps: [
    {
      name: 'motomate-backend',
      cwd: './backend',
      script: 'index.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      max_restarts: 10,
      restart_delay: 2000,
      time: true,
    },
  ],
};

