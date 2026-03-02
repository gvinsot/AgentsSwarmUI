import React, { useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import {
  Wifi as WifiIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  CallEnd as CallEndIcon
} from '@mui/icons-material';

const CallOverlay = () => {
  const [isMuted, setIsMuted] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

  const toggleMute = () => setIsMuted(!isMuted);
  const endCall = () => console.log('Call ended');

  return (
    <Box sx={{
      position: 'fixed',
      left: 16,
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      zIndex: 1000,
      backgroundColor: 'rgba(255,255,255,0.9)',
      borderRadius: '24px',
      padding: '8px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
    }}>
      <Tooltip title={isConnected ? "Connected" : "Disconnected"}>
        <IconButton sx={{ color: isConnected ? 'success.main' : 'error.main' }}>
          <WifiIcon />
        </IconButton>
      </Tooltip>

      <Tooltip title={isMuted ? "Unmute" : "Mute"}>
        <IconButton onClick={toggleMute}>
          {isMuted ? <MicOffIcon /> : <MicIcon />}
        </IconButton>
      </Tooltip>

      <Tooltip title="End Call">
        <IconButton onClick={endCall} sx={{ color: 'error.main' }}>
          <CallEndIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

export default CallOverlay;