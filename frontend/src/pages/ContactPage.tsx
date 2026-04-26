import {
  Container,
  Paper,
  Title,
  Text,
  Stack,
  Center,
  TextInput,
  Textarea,
  Button,
  Group,
} from '@mantine/core';
import { IconMail, IconUser, IconMessage } from '@tabler/icons-react';
import { useState } from 'react';

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle form submission here
    console.log('Form submitted:', formData);
    // Reset form
    setFormData({ name: '', email: '', message: '' });
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Container size='sm' py={{ base: 'md', sm: 'xl' }} px={{ base: 'xs', sm: 'md' }}>
      <Paper shadow='sm' p={{ base: 'md', sm: 'xl' }} radius='md'>
        <Stack gap='lg'>
          <Center>
            <Title order={1}>Contact Us</Title>
          </Center>

          <Text size='lg' c='dimmed' ta='center'>
            Get in touch with us
          </Text>

          <form onSubmit={handleSubmit}>
            <Stack gap='md'>
              <TextInput
                label='Name'
                placeholder='Your name'
                leftSection={<IconUser size={16} />}
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                required
              />

              <TextInput
                label='Email'
                placeholder='your@email.com'
                leftSection={<IconMail size={16} />}
                type='email'
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                required
              />

              <Textarea
                label='Message'
                placeholder='Your message here...'
                leftSection={<IconMessage size={16} />}
                minRows={4}
                value={formData.message}
                onChange={(e) => handleChange('message', e.target.value)}
                required
              />

              <Group justify='center' mt='md'>
                <Button type='submit' size='md' color='green'>
                  Send Message
                </Button>
              </Group>
            </Stack>
          </form>

          <Stack gap='md' mt='xl'>
            <Title order={4}>Other Ways to Reach Us</Title>
            <Text size='sm' c='dimmed'>
              Email: contact@pictur.com
            </Text>
            <Text size='sm' c='dimmed'>
              Phone: +1 (555) 123-4567
            </Text>
            <Text size='sm' c='dimmed'>
              Address: 123 Turtle Street, Ocean City, TC 12345
            </Text>
          </Stack>
        </Stack>
      </Paper>
    </Container>
  );
}
