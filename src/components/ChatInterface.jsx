// [Previous imports]
import CallControlsOverlay from './CallControlsOverlay';

// [Existing component code]

// Remove the bottom indicator and add the new overlay
return (
  <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
    <CallControlsOverlay />
    {/* Rest of the chat interface */}
  </Box>
);