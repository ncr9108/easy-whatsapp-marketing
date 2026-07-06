import React from 'react';
import { SkeletonPage, Layout, Card, SkeletonBodyText, SkeletonDisplayText, TextContainer, Box } from '@shopify/polaris';

export default function Loader() {
  return (
    <SkeletonPage title="Loading app settings...">
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="5">
              <TextContainer>
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={3} />
              </TextContainer>
            </Box>
          </Card>
        </Layout.Section>
        
        <Layout.Section secondary>
          <Card>
            <Box padding="5">
              <TextContainer>
                <SkeletonBodyText lines={2} />
              </TextContainer>
            </Box>
          </Card>
          <Card>
            <Box padding="5">
              <TextContainer>
                <SkeletonBodyText lines={2} />
              </TextContainer>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </SkeletonPage>
  );
}
