import React, { useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import {
  CallEnd as CallEndIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  SignalCellularAlt as SignalIcon
} from '@mui/icons-material';

const CallControlsOverlay = () => {
  const [isMuted, setIsMuted] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('good');

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const endCall = () => {
    // Implement call ending logic
    console.log('Call ended');
  };

  return (
    <Box
      sx={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        zIndex: 1000
      }}
    >
      <Tooltip title="Connection Status">
        <IconButton
          sx={{
            bgcolor: 'background.paper',
            boxShadow: 3,
            borderRadius: '50%',
            width: 48,
            height: 48
          }}
        >
          <SignalIcon
            color={connectionStatus === 'good' ? 'success' : 'error'}
          />
        </IconButton>
      </Tooltip>

      <Tooltip title={isMuted ? 'Unmute' : 'Mute'}>
        <IconButton
          onClick={toggleMute}
          sx={{
            bgcolor: 'background.paper',
            boxShadow: 3,
            borderRadius: '50%',
            width: 48,
            height: 48
          }}
        >
          {isMuted ? <MicOffIcon color="error" /> : <MicIcon />}
        </IconButton>
      </Tooltip>

      <Tooltip title="End Call">
        <IconButton
          onClick={endCall}
          sx={{
            bgcolor: 'error.main',
            color: 'white',
            boxShadow: 3,
            borderRadius: '50%',
            width: 48,
            height: 48,
            '&:hover': {
              bgcolor: 'error.dark'
            }
          }}
        >
          <CallEndIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

export default CallControlsOverlay;